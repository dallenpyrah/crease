import { Clock, Effect, Schema } from 'effect';

import type { FoldkitInspector } from './foldkit-context.js';
import type { FoldkitContext } from './foldkit-schema.js';

export interface AutomaticSource {
  readonly file: string;
  readonly view: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly revision?: string;
}

export interface AutomaticModelSource {
  readonly expression: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly definition?: AutomaticSource;
}

interface Scope {
  readonly source: AutomaticSource;
  readonly boundary: string;
  readonly model: unknown;
  readonly stableSlot: boolean;
  readonly calls: ReadonlyArray<{
    readonly kind: 'submodel' | 'helper';
    readonly source: AutomaticSource;
  }>;
  readonly modelSource?: AutomaticModelSource;
}

interface NodeMetadata {
  readonly source: AutomaticSource;
  readonly scope: Scope;
  readonly events: ReadonlyArray<{ event: string; message: string }>;
}

interface RenderedNode {
  readonly node: object;
  readonly metadata: NodeMetadata;
  readonly instance: string;
}

interface ElementReference {
  readonly reference: string;
  readonly identity: string;
  readonly kind: 'identity' | 'element';
}

interface ReferenceCandidate {
  readonly element: Element;
  readonly rendered: RenderedNode;
  readonly identity: string;
  readonly stableIdentity: boolean;
  readonly excluded: boolean;
}

interface RuntimeRecord {
  readonly id: string;
  root: unknown;
  elements: Map<Element, RenderedNode>;
  references: Map<Element, ElementReference>;
  identityReferences: Map<string, string>;
  keyTokens: Map<string, string>;
  pending: boolean;
}

const createAutomaticContext = () => {
  const REFERENCE_ATTRIBUTE = 'data-creasekit-ref';
  const PRIVATE_OR_OVERLAY_SELECTOR =
    '[data-creasekit-private],[data-crease-private],[data-creasekit-root]';
  const functions = new WeakMap<object, AutomaticSource>();
  const modelDefinitions = new WeakMap<object, AutomaticSource>();
  let nodes = new WeakMap<object, NodeMetadata>();
  let elements = new WeakMap<Element, RenderedNode>();
  const ownedReferences = new Map<Element, string>();
  const runtimes = new Set<RuntimeRecord>();
  const listeners = new Set<() => void>();
  let activeScope: Scope | undefined;
  let excludedKeys = new Set<string>();
  let generation = 0;
  let observer: MutationObserver | undefined;

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  const isVNode = (value: unknown): value is Record<string, unknown> =>
    isRecord(value) && 'sel' in value && 'data' in value && 'elm' in value;

  const dataValue = (value: object, key: string): unknown =>
    Object.getOwnPropertyDescriptor(value, key)?.value;
  const hasAccessors = (value: object): boolean => {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).some(
      (key) => !('value' in Reflect.get(descriptors, key)),
    );
  };

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        listeners.delete(listener);
      }
    }
  };

  const isExcludedElement = (element: Element): boolean => {
    let current: Element | null = element;
    while (current !== null) {
      if (current.matches(PRIVATE_OR_OVERLAY_SELECTOR)) return true;
      if (current.parentElement !== null) {
        current = current.parentElement;
        continue;
      }
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
  };

  const referenceIdentity = (rendered: RenderedNode): string =>
    JSON.stringify([
      rendered.instance,
      rendered.metadata.source.file,
      rendered.metadata.source.view,
      rendered.metadata.source.line,
      rendered.metadata.source.column,
    ]);

  const ownsReference = (element: Element, reference: string): boolean =>
    ownedReferences.get(element) === reference &&
    element.getAttribute(REFERENCE_ATTRIBUTE) === reference;

  const installReference = (element: Element, reference: string): boolean => {
    const owned = ownedReferences.get(element);
    const current = element.getAttribute(REFERENCE_ATTRIBUTE);
    if (owned !== undefined && current !== owned) ownedReferences.delete(element);
    if (ownedReferences.get(element) === undefined) {
      if (current !== null) return false;
      element.setAttribute(REFERENCE_ATTRIBUTE, reference);
      ownedReferences.set(element, reference);
      return true;
    }
    if (ownedReferences.get(element) !== reference) {
      element.setAttribute(REFERENCE_ATTRIBUTE, reference);
      ownedReferences.set(element, reference);
    }
    return true;
  };

  const releaseReference = (element: Element, reference: string): void => {
    if (ownedReferences.get(element) !== reference) return;
    if (element.getAttribute(REFERENCE_ATTRIBUTE) === reference)
      element.removeAttribute(REFERENCE_ATTRIBUTE);
    ownedReferences.delete(element);
  };

  const clearRuntimeElements = (runtime: RuntimeRecord): void => {
    for (const [element, rendered] of runtime.elements) {
      if (elements.get(element) === rendered) elements.delete(element);
    }
    runtime.elements.clear();
  };

  const clearRuntimeReferences = (runtime: RuntimeRecord): void => {
    for (const [element, reference] of runtime.references)
      releaseReference(element, reference.reference);
    runtime.references.clear();
    runtime.identityReferences.clear();
    runtime.keyTokens.clear();
  };

  const discardReplacedReferences = (runtime: RuntimeRecord): void => {
    for (const [element, reference] of runtime.references) {
      if (ownsReference(element, reference.reference)) continue;
      if (ownedReferences.get(element) === reference.reference)
        ownedReferences.delete(element);
      runtime.references.delete(element);
      if (runtime.identityReferences.get(reference.identity) === reference.reference)
        runtime.identityReferences.delete(reference.identity);
    }
  };

  const prune = (): boolean => {
    let changed = false;
    for (const runtime of runtimes) {
      if (
        !isVNode(runtime.root) ||
        !(runtime.root.elm instanceof Element) ||
        runtime.root.elm.isConnected
      )
        continue;
      clearRuntimeElements(runtime);
      clearRuntimeReferences(runtime);
      runtime.root = undefined;
      runtimes.delete(runtime);
      changed = true;
    }
    return changed;
  };

  const sourceOf = (value: unknown, fallback: AutomaticSource): AutomaticSource =>
    typeof value === 'function' ? (functions.get(value) ?? fallback) : fallback;

  const registerFunction = <T>(
    value: T,
    source: AutomaticSource,
    modelDefinition?: AutomaticSource,
  ): T => {
    if (typeof value === 'function') {
      functions.set(value, source);
      if (modelDefinition !== undefined) modelDefinitions.set(value, modelDefinition);
    }
    return value;
  };

  const modelOrigin = (
    view: object,
    source: AutomaticModelSource | undefined,
  ): AutomaticModelSource | undefined => {
    if (source === undefined) return undefined;
    const definition = modelDefinitions.get(view) ?? source.definition;
    return definition === undefined ? source : { ...source, definition };
  };

  const commit = (runtime: RuntimeRecord): void => {
    runtime.pending = false;
    discardReplacedReferences(runtime);
    clearRuntimeElements(runtime);
    const pending = [{ node: runtime.root, keys: '', keyed: false }];
    const seen = new Set<object>();
    const candidates: Array<ReferenceCandidate> = [];
    const keyTokens = new Map<string, string>();
    while (pending.length > 0 && seen.size < 20_000) {
      const next = pending.pop();
      if (next === undefined || !isVNode(next.node) || seen.has(next.node)) continue;
      const node = next.node;
      seen.add(node);
      const key = node.key;
      const hasKey = typeof key === 'string' || typeof key === 'number';
      const keys = `${next.keys}${hasKey ? `/${JSON.stringify(key)}` : ''}`;
      const keyed = next.keyed || hasKey;
      const metadata = nodes.get(node);
      if (metadata !== undefined && node.elm instanceof Element) {
        const keyToken =
          keys === ''
            ? ''
            : (keyTokens.get(keys) ??
              runtime.keyTokens.get(keys) ??
              Effect.runSync(Effect.sync(() => crypto.randomUUID())));
        if (keys !== '') keyTokens.set(keys, keyToken);
        const rendered: RenderedNode = {
          node,
          metadata,
          instance: `${runtime.id}|${metadata.scope.boundary}|${keyToken}`,
        };
        const candidate: ReferenceCandidate = {
          element: node.elm,
          rendered,
          identity: referenceIdentity(rendered),
          stableIdentity: keyed || metadata.scope.stableSlot,
          excluded: isExcludedElement(node.elm),
        };
        candidates.push(candidate);
        if (!candidate.excluded && node.elm.isConnected) {
          elements.set(node.elm, rendered);
          runtime.elements.set(node.elm, rendered);
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) pending.push({ node: child, keys, keyed });
      }
    }

    runtime.keyTokens = keyTokens;

    const identityCounts = new Map<string, number>();
    for (const candidate of candidates) {
      identityCounts.set(
        candidate.identity,
        (identityCounts.get(candidate.identity) ?? 0) + 1,
      );
    }
    const nextReferences = new Map<Element, ElementReference>();
    const nextIdentityReferences = new Map<string, string>();
    for (const candidate of candidates) {
      if (candidate.excluded) continue;
      const unique = identityCounts.get(candidate.identity) === 1;
      if (candidate.stableIdentity && unique) {
        const reference =
          runtime.identityReferences.get(candidate.identity) ??
          `ck_${Effect.runSync(Effect.sync(() => crypto.randomUUID()))}`;
        if (!installReference(candidate.element, reference)) continue;
        nextReferences.set(candidate.element, {
          reference,
          identity: candidate.identity,
          kind: 'identity',
        });
        nextIdentityReferences.set(candidate.identity, reference);
        continue;
      }

      const previous = runtime.references.get(candidate.element);
      const reference =
        previous?.kind === 'element' &&
        previous.identity === candidate.identity &&
        ownsReference(candidate.element, previous.reference)
          ? previous.reference
          : `ck_${Effect.runSync(Effect.sync(() => crypto.randomUUID()))}`;
      if (!installReference(candidate.element, reference)) continue;
      nextReferences.set(candidate.element, {
        reference,
        identity: candidate.identity,
        kind: 'element',
      });
    }
    for (const [element, reference] of runtime.references) {
      if (nextReferences.get(element)?.reference !== reference.reference)
        releaseReference(element, reference.reference);
    }
    runtime.references.clear();
    for (const [element, reference] of nextReferences)
      runtime.references.set(element, reference);
    runtime.identityReferences.clear();
    for (const [identity, reference] of nextIdentityReferences)
      runtime.identityReferences.set(identity, reference);
    prune();
    notify();
  };

  const observeRuntime = <T>(
    config: T,
    source: AutomaticSource,
    modelSource?: AutomaticModelSource,
  ): T => {
    if (!isRecord(config) || hasAccessors(config)) return config;
    const view = dataValue(config, 'view');
    if (typeof view !== 'function') return config;
    const runtime: RuntimeRecord = {
      id: Effect.runSync(Effect.sync(() => crypto.randomUUID())),
      root: undefined,
      elements: new Map(),
      references: new Map(),
      identityReferences: new Map(),
      keyTokens: new Map(),
      pending: false,
    };
    const currentGeneration = generation;
    const origin = modelOrigin(view, modelSource);
    if (
      observer === undefined &&
      typeof MutationObserver !== 'undefined' &&
      document.documentElement !== null
    ) {
      observer = new MutationObserver(() => {
        if (prune()) notify();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    const wrapped = {
      ...config,
      view(this: unknown, ...args: unknown[]) {
        const previous = activeScope;
        const owner = sourceOf(view, source);
        activeScope = {
          source: owner,
          boundary: `${owner.file}#${owner.view}`,
          model: args[0],
          stableSlot: false,
          calls: [],
          ...(origin === undefined ? {} : { modelSource: origin }),
        };
        try {
          const result: unknown = view.apply(this, args);
          runtime.root = isRecord(result) && 'body' in result ? result.body : result;
          if (!runtime.pending && currentGeneration === generation) {
            runtimes.add(runtime);
            runtime.pending = true;
            queueMicrotask(() => {
              if (currentGeneration === generation) commit(runtime);
            });
          }
          return result;
        } finally {
          activeScope = previous;
        }
      },
    };
    return wrapped;
  };

  const captureCall = (
    fn: unknown,
    receiver: unknown,
    args: unknown[],
    source: AutomaticSource,
    kind: 'element' | 'submodel' | 'helper',
    modelSource?: AutomaticModelSource,
  ): unknown => {
    if (typeof fn !== 'function')
      throw new TypeError('The instrumented FoldKit builder is not callable');
    const parent = activeScope;
    if (kind === 'helper' && parent !== undefined) {
      activeScope = {
        ...parent,
        calls: [...parent.calls, { kind, source }].slice(-8),
      };
      try {
        return fn.apply(receiver, args);
      } finally {
        activeScope = parent;
      }
    }
    const config = args[0];
    if (
      kind === 'submodel' &&
      (!isRecord(config) ||
        hasAccessors(config) ||
        (isRecord(config.viewInputs) && hasAccessors(config.viewInputs)))
    ) {
      activeScope = undefined;
      try {
        return fn.apply(receiver, args);
      } finally {
        activeScope = parent;
      }
    }
    if (
      kind !== 'submodel' ||
      parent === undefined ||
      !isRecord(config) ||
      typeof config.view !== 'function'
    ) {
      const result: unknown = fn.apply(receiver, args);
      if (parent !== undefined && isVNode(result)) {
        const attributes = args.find(Array.isArray);
        const events: Array<{ event: string; message: string }> = [];
        for (const attribute of attributes ?? []) {
          const tag = isRecord(attribute) ? dataValue(attribute, '_tag') : undefined;
          const message = isRecord(attribute)
            ? dataValue(attribute, 'message')
            : undefined;
          const messageTag = isRecord(message) ? dataValue(message, '_tag') : undefined;
          if (
            typeof tag === 'string' &&
            tag.startsWith('On') &&
            typeof messageTag === 'string'
          ) {
            events.push({
              event: tag.slice(2).toLowerCase(),
              message: messageTag,
            });
          }
        }
        nodes.set(result, { source, scope: parent, events });
      }
      return result;
    }
    const view = config.view;
    const owner = sourceOf(view, source);
    const origin = modelOrigin(view, modelSource);
    const slotId = typeof config.slotId === 'string' ? config.slotId : undefined;
    const scope: Scope = {
      source: owner,
      boundary: `${parent.boundary}/${slotId === undefined ? '(unknown slot)' : slotId.replaceAll('%', '%25').replaceAll('/', '%2F')}`,
      model: config.model,
      stableSlot: parent.stableSlot || slotId !== undefined,
      calls: [...parent.calls, { kind: 'submodel' as const, source }].slice(-8),
      ...(origin === undefined ? {} : { modelSource: origin }),
    };
    const viewInputs = config.viewInputs;
    const inputs = isRecord(viewInputs)
      ? Object.fromEntries(
          Object.entries(viewInputs).map(([key, value]) => {
            if (typeof value !== 'function') return [key, value];
            return [
              key,
              function (this: unknown, ...values: unknown[]) {
                const previous = activeScope;
                activeScope = parent;
                try {
                  return value.apply(this, values);
                } finally {
                  activeScope = previous;
                }
              },
            ];
          }),
        )
      : undefined;
    let viewResult: unknown;
    const nextConfig = {
      ...config,
      ...(inputs === undefined ? {} : { viewInputs: inputs }),
      view(this: unknown, ...values: unknown[]) {
        const previous = activeScope;
        activeScope = scope;
        try {
          viewResult = view.apply(this, values);
          return viewResult;
        } finally {
          activeScope = previous;
        }
      },
    };
    const result: unknown = fn.apply(receiver, [nextConfig, ...args.slice(1)]);
    if (isVNode(result) && isVNode(viewResult)) {
      const metadata = nodes.get(viewResult);
      if (metadata !== undefined) nodes.set(result, metadata);
    }
    return result;
  };

  const serializeModel = (value: unknown): Schema.JsonObject => {
    const seen = new WeakSet<object>();
    let remaining = 8_000;
    const visit = (input: unknown, depth: number): Schema.Json => {
      if (remaining <= 0) return '[size limit]';
      if (depth > 5) return '[depth limit]';
      if (input === null || typeof input === 'boolean') return input;
      if (typeof input === 'number') return Number.isFinite(input) ? input : null;
      if (typeof input === 'string') {
        const text = input.slice(0, Math.min(500, remaining));
        remaining -= text.length;
        return text;
      }
      if (!isRecord(input)) return '[not serializable]';
      if (seen.has(input)) return '[circular]';
      seen.add(input);
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const entries = Object.entries(descriptors)
        .filter(([key, descriptor]) => descriptor.enumerable && key !== 'length')
        .slice(0, 20);
      const values = entries.map(([key, descriptor]): [string, Schema.Json] => {
        remaining -= key.length + 8;
        if (
          excludedKeys.has(key) ||
          /password|secret|token|authorization|cookie|credential|api.?key|private.?key|access.?key|session/i.test(
            key,
          )
        )
          return [key, '[redacted]'];
        if (!('value' in descriptor)) return [key, '[accessor omitted]'];
        return [key, visit(descriptor.value, depth + 1)];
      });
      return Array.isArray(input)
        ? values.map(([, item]) => item)
        : Object.fromEntries(values);
    };
    try {
      const result = visit(value, 0);
      const object = Schema.decodeUnknownSync(Schema.JsonObject)(
        typeof result === 'object' && result !== null && !Array.isArray(result)
          ? result
          : { value: result },
      );
      return JSON.stringify(object).length <= 8_000
        ? object
        : { status: 'Model exceeds 8KB; add field exclusions.' };
    } catch {
      return { status: 'The rendered Model could not be safely read.' };
    }
  };

  const configureAutomaticContext = (keys: ReadonlyArray<string>): void => {
    excludedKeys = new Set(keys);
  };

  const resetAutomaticContext = (): void => {
    generation += 1;
    observer?.disconnect();
    observer = undefined;
    for (const runtime of runtimes) {
      clearRuntimeElements(runtime);
      clearRuntimeReferences(runtime);
      runtime.root = undefined;
    }
    runtimes.clear();
    for (const [element, reference] of ownedReferences)
      releaseReference(element, reference);
    ownedReferences.clear();
    nodes = new WeakMap();
    elements = new WeakMap();
    activeScope = undefined;
    notify();
  };

  const automaticInspector: FoldkitInspector = {
    inspect(element, includeModel) {
      if (!element.isConnected || isExcludedElement(element)) return undefined;
      let owner: Element | null = element;
      let found: RenderedNode | undefined;
      while (owner !== null) {
        found = elements.get(owner);
        if (found !== undefined && isVNode(found.node) && found.node.elm === owner)
          break;
        owner = owner.parentElement;
      }
      if (found === undefined || owner === null) return undefined;
      const { metadata, instance } = found;
      const layout: Array<typeof import('./foldkit-schema.js').FoldkitLayout.Type> = [];
      let ancestor = element.parentElement;
      while (ancestor !== null && layout.length < 4) {
        if (isExcludedElement(ancestor)) break;
        const entry = elements.get(ancestor);
        const rect = ancestor.getBoundingClientRect();
        const style = getComputedStyle(ancestor);
        layout.push({
          tag: ancestor.tagName.toLowerCase(),
          ...(entry !== undefined && isVNode(entry.node) && entry.node.elm === ancestor
            ? { source: { ...entry.metadata.source } }
            : {}),
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          display: style.display,
          position: style.position,
          padding: style.padding,
          border: style.border,
          gap: style.gap,
          overflow: style.overflow,
          scrollTop: ancestor.scrollTop,
          scrollLeft: ancestor.scrollLeft,
        });
        ancestor = ancestor.parentElement;
      }
      return {
        provenance: 'automatic-instrumentation',
        boundary: metadata.scope.boundary,
        source: { ...metadata.scope.source },
        ...(owner === element ? { elementSource: { ...metadata.source } } : {}),
        calls: metadata.scope.calls.map((call) => ({
          ...call,
          source: { ...call.source },
        })),
        layout,
        ...(metadata.scope.modelSource === undefined
          ? {}
          : { modelSource: structuredClone(metadata.scope.modelSource) }),
        instanceKey: instance,
        events: owner === element ? metadata.events.map((event) => ({ ...event })) : [],
        availability: [
          'Model values describe the rendered scope, not proven per-element dependencies.',
          'Runtime history is unavailable without an unambiguous FoldKit DevTools connection.',
          'Only instrumented helper and submodel invocations are observed; other caller edges may be missing.',
          'Ancestor layout and authored style references are candidates, not a diagnosis or a verified CSS cascade winner.',
          ...(owner === element
            ? []
            : [
                'This element was not instrumented; the nearest verified owning view is shown.',
              ]),
        ],
        ...(includeModel ? { model: serializeModel(metadata.scope.model) } : {}),
        capturedAt: Effect.runSync(Clock.currentTimeMillis),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolve(context: FoldkitContext) {
      if (context.elementSource === undefined || context.instanceKey === undefined)
        return undefined;
      const matches: Element[] = [];
      for (const runtime of runtimes) {
        for (const [element, entry] of runtime.elements) {
          const source = entry.metadata.source;
          if (
            element.isConnected &&
            entry.instance === context.instanceKey &&
            source.file === context.elementSource.file &&
            source.line === context.elementSource.line &&
            source.column === context.elementSource.column &&
            source.view === context.elementSource.view
          )
            matches.push(element);
        }
      }
      return matches.length === 1 ? matches[0] : undefined;
    },
  };

  return {
    registerFunction,
    observeRuntime,
    captureCall,
    configureAutomaticContext,
    resetAutomaticContext,
    automaticInspector,
  };
};

export const {
  registerFunction,
  observeRuntime,
  captureCall,
  configureAutomaticContext,
  resetAutomaticContext,
  automaticInspector,
} = createAutomaticContext();
