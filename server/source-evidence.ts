import { createHash } from 'node:crypto';
import { constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ParserPlugin, parse } from '@babel/parser';
import type {
  Function as BabelFunction,
  CallExpression,
  Expression,
  Identifier,
  Node,
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
  Program,
  SpreadElement,
} from '@babel/types';
import { Schema } from 'effect';

import {
  type SourceEvidence,
  type SourceSpan,
  SourceSpan as SourceSpanSchema,
} from '../src/source-schema.js';
import type { AutomaticSourceReference } from './automatic-transform.js';

export const SOURCE_CONTEXT_PATH = '/__creasekit/source-context';
export const MAX_SOURCE_CONTEXT_BATCH = 64;
export const MAX_SOURCE_SNIPPET_CHARS = 2_000;
export const MAX_SOURCE_TOTAL_SNIPPET_CHARS = 32_000;

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_STYLE_CANDIDATES = 24;
const MAX_STYLE_DEPTH = 10;
const MAX_STYLE_MODULES = 16;
const MAX_RETIRED_REFERENCES = 512;
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const SOURCE_KEYS = new Set([
  'file',
  'view',
  'line',
  'column',
  'endLine',
  'endColumn',
  'revision',
]);
const CREDENTIAL_NAME =
  /(?:api.?key|access.?key|private.?key|client.?secret|credential|password|passwd|secret|token)/iu;
const REDACTION_MARKER = '[REDACTED credential-shaped literal]';

const SourceContextRequest = Schema.Struct({
  sources: Schema.Array(SourceSpanSchema),
});

export type SourceResolver = (
  specifier: string,
  importer: string,
) => Promise<string | undefined>;

interface RegisteredModule {
  readonly id: string;
  readonly path: string;
  readonly file: string;
  readonly revision: string;
  readonly originalProven: boolean;
  readonly references: ReadonlyArray<AutomaticSourceReference>;
}

interface RegisteredReference {
  readonly module: RegisteredModule;
  readonly reference: AutomaticSourceReference;
}

interface Scope {
  readonly parent?: Scope;
  readonly bindings: Map<string, Binding>;
}

interface ImportBinding {
  readonly source: string;
  readonly imported: string;
  readonly kind: 'default' | 'named' | 'namespace';
}

interface Binding {
  readonly name: string;
  readonly scope: Scope;
  readonly declaration: Node;
  readonly initializer?: Expression | null;
  readonly functionNode?: BabelFunction;
  readonly import?: ImportBinding;
  readonly restParameter?: boolean;
}

type ExportTarget =
  | { readonly kind: 'local'; readonly local: string }
  | {
      readonly kind: 'reexport';
      readonly source: string;
      readonly imported: string;
    };

interface Redaction {
  readonly start: number;
  readonly end: number;
}

interface ParsedModule {
  readonly path: string;
  readonly file: string;
  readonly code: string;
  readonly revision: string;
  readonly program: Program;
  readonly rootScope: Scope;
  readonly scopes: WeakMap<Node, Scope>;
  readonly exports: ReadonlyMap<string, ExportTarget>;
  readonly redactions: ReadonlyArray<Redaction>;
}

interface RequestState {
  readonly modules: Map<string, Promise<ParsedModule | undefined>>;
  readonly importResolutions: Map<string, Promise<ResolvedImport>>;
  readonly visitedModules: Set<string>;
  remainingSnippetChars: number;
}

type ResolvedImport = { readonly module: ParsedModule } | { readonly reason: string };

interface ResolvedBinding {
  readonly module: ParsedModule;
  readonly binding: Binding;
}

interface StyleDefinition {
  readonly module: ParsedModule;
  readonly node: ObjectMethod | ObjectProperty;
}

interface StyleResolution {
  readonly definition?: StyleDefinition;
  readonly reason?: string;
}

interface StyleCandidate {
  readonly expression: string;
  readonly use: SourceSpan;
  readonly definition?: SourceSpan & {
    readonly snippet?: string;
    readonly snippetTruncated?: boolean;
    readonly status?: 'current' | 'stale' | 'unavailable';
  };
  readonly reason?: string;
}

interface StyleCollection {
  readonly source: SourceSpan;
  readonly candidates: Array<StyleCandidate>;
  readonly seen: Set<string>;
  readonly state: RequestState;
}

export class InvalidSourceContextRequestError extends Error {}

export const decodeSourceContextRequest = (
  input: unknown,
): ReadonlyArray<SourceSpan> => {
  if (!isPlainRecord(input) || !hasOnlyKeys(input, new Set(['sources']))) {
    throw new InvalidSourceContextRequestError();
  }
  const rawSources = input.sources;
  if (!Array.isArray(rawSources) || rawSources.length > MAX_SOURCE_CONTEXT_BATCH) {
    throw new InvalidSourceContextRequestError();
  }
  for (const source of rawSources) {
    if (
      !isPlainRecord(source) ||
      !hasOnlyKeys(source, SOURCE_KEYS) ||
      !validSourceInput(source)
    ) {
      throw new InvalidSourceContextRequestError();
    }
  }
  try {
    return Schema.decodeUnknownSync(SourceContextRequest)(input).sources;
  } catch {
    throw new InvalidSourceContextRequestError();
  }
};

export class SourceEvidenceRegistry {
  readonly #root: string;
  readonly #modules = new Map<string, RegisteredModule>();
  readonly #references = new Map<string, RegisteredReference>();
  readonly #retiredReferences = new Set<string>();
  #resolver: SourceResolver | undefined;

  constructor(root: string) {
    this.#root = realpathSync(root);
  }

  setResolver(resolver: SourceResolver): void {
    this.#resolver = resolver;
  }

  registerTransform(
    id: string,
    code: string,
    references: ReadonlyArray<AutomaticSourceReference>,
  ): void {
    const normalizedId = normalizeModuleId(id, this.#root);
    if (normalizedId === undefined) return;
    this.#removeModule(normalizedId);
    if (references.length === 0) return;

    let canonical: string;
    try {
      canonical = realpathSync(normalizedId);
    } catch {
      return;
    }
    if (!isAllowedSourcePath(this.#root, canonical)) return;
    const file = projectFile(this.#root, canonical);
    if (file === undefined) return;
    const revision = sha256(code);
    const accepted = references.filter((reference) =>
      validAutomaticReference(reference, code, file, revision),
    );
    if (accepted.length === 0) return;

    let originalProven = false;
    try {
      const stat = statSync(canonical);
      if (stat.isFile() && stat.size <= MAX_SOURCE_FILE_BYTES) {
        originalProven = sha256(readFileSync(canonical)) === revision;
      }
    } catch {
      originalProven = false;
    }
    const module: RegisteredModule = {
      id: normalizedId,
      path: canonical,
      file,
      revision,
      originalProven,
      references: accepted,
    };
    this.#modules.set(normalizedId, module);
    for (const reference of accepted) {
      const key = sourceKey(reference.source);
      this.#retiredReferences.delete(key);
      this.#references.set(key, { module, reference });
    }
  }

  unregisterTransform(id: string): void {
    const normalizedId = normalizeModuleId(id, this.#root);
    if (normalizedId !== undefined) this.#removeModule(normalizedId);
  }

  async sources(
    sources: ReadonlyArray<SourceSpan>,
  ): Promise<ReadonlyArray<SourceEvidence>> {
    const state: RequestState = {
      modules: new Map(),
      importResolutions: new Map(),
      visitedModules: new Set(),
      remainingSnippetChars: MAX_SOURCE_TOTAL_SNIPPET_CHARS,
    };
    const results: Array<SourceEvidence> = [];
    for (const requested of sources) {
      const registered = this.#references.get(sourceKey(requested));
      if (registered === undefined) {
        results.push({ ...requested, snippetTruncated: false, status: 'unavailable' });
        continue;
      }
      results.push(await this.#source(registered, state));
    }
    return results;
  }

  #removeModule(id: string): void {
    const previous = this.#modules.get(id);
    if (previous === undefined) return;
    this.#modules.delete(id);
    for (const reference of previous.references) {
      const key = sourceKey(reference.source);
      if (this.#references.get(key)?.module !== previous) continue;
      this.#retiredReferences.delete(key);
      this.#retiredReferences.add(key);
    }
    while (this.#retiredReferences.size > MAX_RETIRED_REFERENCES) {
      const oldest = this.#retiredReferences.values().next().value;
      if (oldest === undefined) break;
      this.#retiredReferences.delete(oldest);
      const registered = this.#references.get(oldest);
      if (
        registered !== undefined &&
        this.#modules.get(registered.module.id) !== registered.module
      ) {
        this.#references.delete(oldest);
      }
    }
  }

  async #source(
    registered: RegisteredReference,
    state: RequestState,
  ): Promise<SourceEvidence> {
    const { module, reference } = registered;
    if (!module.originalProven) {
      return {
        ...reference.source,
        snippetTruncated: false,
        status: 'unavailable',
      };
    }
    const current = await this.#loadModule(module.path, state);
    if (current === undefined) {
      return {
        ...reference.source,
        snippetTruncated: false,
        status: 'unavailable',
      };
    }
    if (current.revision !== module.revision) {
      return { ...reference.source, snippetTruncated: false, status: 'stale' };
    }

    const excerpt = takeSnippet(
      current,
      reference.snippetStart,
      reference.snippetEnd,
      reference.snippetTruncated,
      state,
    );
    const styles =
      reference.attributesStart === undefined || reference.attributesEnd === undefined
        ? undefined
        : await this.#styles(
            current,
            reference.attributesStart,
            reference.attributesEnd,
            reference.source,
            state,
          );
    return {
      ...reference.source,
      ...(excerpt.snippet === undefined ? {} : { snippet: excerpt.snippet }),
      snippetTruncated: excerpt.truncated,
      status: 'current',
      ...(styles === undefined ? {} : { styles }),
    };
  }

  async #loadModule(
    path: string,
    state: RequestState,
  ): Promise<ParsedModule | undefined> {
    let pending = state.modules.get(path);
    if (pending === undefined) {
      pending = loadModule(this.#root, path);
      state.modules.set(path, pending);
    }
    return pending;
  }

  async #styles(
    module: ParsedModule,
    start: number,
    end: number,
    source: SourceSpan,
    state: RequestState,
  ): Promise<ReadonlyArray<StyleCandidate>> {
    const attributes = findExpression(module.program, start, end);
    if (attributes === undefined) {
      return [
        {
          expression: '(attributes)',
          use: source,
          reason: 'instrumented attribute expression is no longer available',
        },
      ];
    }
    const collection: StyleCollection = {
      source,
      candidates: [],
      seen: new Set(),
      state,
    };
    await this.#scanForClassExpressions(
      attributes,
      module,
      module.scopes.get(attributes) ?? module.rootScope,
      collection,
      0,
    );
    return collection.candidates;
  }

  async #scanForClassExpressions(
    node: Node,
    module: ParsedModule,
    scope: Scope,
    collection: StyleCollection,
    depth: number,
  ): Promise<void> {
    if (
      depth > MAX_STYLE_DEPTH ||
      collection.candidates.length >= MAX_STYLE_CANDIDATES
    ) {
      return;
    }
    if (node.type === 'CallExpression') {
      if (isStylexCall(node, 'props', module, scope)) {
        for (const argument of node.arguments) {
          await this.#collectStyleArgument(
            argument,
            module,
            module.scopes.get(argument) ?? scope,
            collection,
            depth + 1,
          );
        }
        return;
      }
      const forwarded = await this.#forwardedStyleArguments(
        node,
        module,
        scope,
        collection.state,
        depth + 1,
      );
      if (forwarded !== undefined) {
        if (forwarded.expressions.length === 0 && forwarded.reason !== undefined) {
          await this.#addStyleCandidate(node, module, collection, {
            reason: forwarded.reason,
          });
        }
        for (const expression of forwarded.expressions) {
          await this.#collectStyleValue(
            expression,
            module,
            module.scopes.get(expression) ?? scope,
            collection,
            depth + 1,
          );
        }
        return;
      }
    }
    const children: Array<Node> = [];
    forEachChild(node, (child) => children.push(child));
    for (const child of children) {
      await this.#scanForClassExpressions(
        child,
        module,
        module.scopes.get(child) ?? scope,
        collection,
        depth + 1,
      );
    }
  }

  async #collectStyleArgument(
    argument: Expression | SpreadElement | Node,
    module: ParsedModule,
    scope: Scope,
    collection: StyleCollection,
    depth: number,
  ): Promise<void> {
    if (argument.type === 'SpreadElement') {
      await this.#collectStyleValue(
        argument.argument,
        module,
        module.scopes.get(argument.argument) ?? scope,
        collection,
        depth,
      );
      return;
    }
    if (isExpressionNode(argument)) {
      await this.#collectStyleValue(argument, module, scope, collection, depth);
    }
  }

  async #collectStyleValue(
    value: Expression,
    module: ParsedModule,
    scope: Scope,
    collection: StyleCollection,
    depth: number,
  ): Promise<void> {
    if (
      depth > MAX_STYLE_DEPTH ||
      collection.candidates.length >= MAX_STYLE_CANDIDATES
    ) {
      return;
    }
    const expression = unwrapExpression(value);
    switch (expression.type) {
      case 'ArrayExpression':
        for (const element of expression.elements) {
          if (element !== null) {
            await this.#collectStyleArgument(
              element,
              module,
              module.scopes.get(element) ?? scope,
              collection,
              depth + 1,
            );
          }
        }
        return;
      case 'ConditionalExpression':
        await this.#collectStyleValue(
          expression.consequent,
          module,
          module.scopes.get(expression.consequent) ?? scope,
          collection,
          depth + 1,
        );
        await this.#collectStyleValue(
          expression.alternate,
          module,
          module.scopes.get(expression.alternate) ?? scope,
          collection,
          depth + 1,
        );
        return;
      case 'LogicalExpression':
        if (expression.operator !== '&&') {
          await this.#collectStyleValue(
            expression.left,
            module,
            module.scopes.get(expression.left) ?? scope,
            collection,
            depth + 1,
          );
        }
        await this.#collectStyleValue(
          expression.right,
          module,
          module.scopes.get(expression.right) ?? scope,
          collection,
          depth + 1,
        );
        return;
      case 'SequenceExpression':
        for (const nested of expression.expressions) {
          await this.#collectStyleValue(
            nested,
            module,
            module.scopes.get(nested) ?? scope,
            collection,
            depth + 1,
          );
        }
        return;
      case 'BooleanLiteral':
      case 'NullLiteral':
      case 'NumericLiteral':
      case 'StringLiteral':
        return;
      case 'UnaryExpression':
        if (expression.operator === '!' || expression.operator === 'void') return;
        break;
      case 'CallExpression': {
        if (isStylexCall(expression, 'props', module, scope)) {
          for (const argument of expression.arguments) {
            await this.#collectStyleArgument(
              argument,
              module,
              module.scopes.get(argument) ?? scope,
              collection,
              depth + 1,
            );
          }
          return;
        }
        const forwarded = await this.#forwardedStyleArguments(
          expression,
          module,
          scope,
          collection.state,
          depth + 1,
        );
        if (forwarded !== undefined) {
          if (forwarded.expressions.length === 0) {
            await this.#addStyleCandidate(expression, module, collection, {
              reason:
                forwarded.reason ??
                'class helper does not forward a statically supported style value',
            });
          }
          for (const forwardedExpression of forwarded.expressions) {
            await this.#collectStyleValue(
              forwardedExpression,
              module,
              module.scopes.get(forwardedExpression) ?? scope,
              collection,
              depth + 1,
            );
          }
          return;
        }
        await this.#addStyleCandidate(expression, module, collection, {
          reason: 'unsupported dynamic style expression',
        });
        return;
      }
    }

    if (expression.type === 'Identifier' || expression.type === 'MemberExpression') {
      const resolution = await this.#resolveStyleDefinition(
        expression,
        module,
        scope,
        collection.state,
        depth + 1,
        new Set(),
      );
      await this.#addStyleCandidate(expression, module, collection, resolution);
      return;
    }
    await this.#addStyleCandidate(expression, module, collection, {
      reason: 'unsupported static style expression',
    });
  }

  async #addStyleCandidate(
    expression: Node,
    module: ParsedModule,
    collection: StyleCollection,
    resolution: StyleResolution,
  ): Promise<void> {
    if (collection.candidates.length >= MAX_STYLE_CANDIDATES) return;
    const use = spanForNode(module, expression, collection.source.view);
    const definition = resolution.definition;
    const key = `${sourceKey(use)}\u0000${
      definition === undefined
        ? (resolution.reason ?? '')
        : `${definition.module.path}:${definition.node.start}:${definition.node.end}`
    }`;
    if (collection.seen.has(key)) return;
    collection.seen.add(key);

    let enrichedDefinition: StyleCandidate['definition'];
    let redacted = false;
    if (definition !== undefined) {
      const start = definition.node.start ?? 0;
      const end = definition.node.end ?? start;
      const excerpt = takeSnippet(
        definition.module,
        start,
        end,
        false,
        collection.state,
      );
      redacted = excerpt.redacted;
      enrichedDefinition = {
        ...spanForNode(
          definition.module,
          definition.node,
          expressionLabel(expression, module.code),
        ),
        ...(excerpt.snippet === undefined ? {} : { snippet: excerpt.snippet }),
        snippetTruncated: excerpt.truncated,
        status: 'current',
      };
    }
    collection.candidates.push({
      expression: expressionLabel(expression, module.code),
      use,
      ...(enrichedDefinition === undefined ? {} : { definition: enrichedDefinition }),
      ...(resolution.reason === undefined && !redacted
        ? {}
        : {
            reason:
              resolution.reason ??
              'definition snippet contains a redacted credential-shaped literal',
          }),
    });
  }

  async #forwardedStyleArguments(
    call: CallExpression,
    module: ParsedModule,
    scope: Scope,
    state: RequestState,
    depth: number,
  ): Promise<
    | {
        readonly expressions: ReadonlyArray<Expression>;
        readonly reason?: string;
      }
    | undefined
  > {
    if (depth > MAX_STYLE_DEPTH || call.callee.type !== 'Identifier') {
      return undefined;
    }
    const local = resolveBinding(scope, call.callee.name);
    if (local === undefined || isStylexPackageImport(local.import)) return undefined;
    const resolved = await this.#followBinding(module, local, state, depth + 1);
    if ('reason' in resolved) return undefined;
    const fn = resolved.binding.functionNode;
    if (fn === undefined) return undefined;
    const propsCalls = returnedStylexPropsCalls(
      fn,
      resolved.module,
      resolved.module.scopes.get(fn) ?? resolved.binding.scope,
    );
    if (propsCalls.length === 0) return undefined;

    const parameters = fn.params.map(parameterDescriptor);
    const forwarded: Array<Expression> = [];
    let unsupported = false;
    for (const propsCall of propsCalls) {
      for (const argument of propsCall.arguments) {
        if (argument.type === 'SpreadElement') {
          const spread = unwrapExpression(argument.argument);
          if (spread.type !== 'Identifier') {
            unsupported = true;
            continue;
          }
          const index = parameters.findIndex(
            (parameter) => parameter?.name === spread.name && parameter.rest,
          );
          if (index < 0) {
            unsupported = true;
            continue;
          }
          for (const callArgument of call.arguments.slice(index)) {
            if (
              callArgument.type !== 'SpreadElement' &&
              isExpressionNode(callArgument)
            ) {
              forwarded.push(callArgument);
            } else {
              unsupported = true;
            }
          }
          continue;
        }
        const propsArgument = unwrapExpression(argument);
        if (propsArgument.type !== 'Identifier') {
          unsupported = true;
          continue;
        }
        const index = parameters.findIndex(
          (parameter) => parameter?.name === propsArgument.name,
        );
        const callArgument = index < 0 ? undefined : call.arguments[index];
        if (
          callArgument === undefined ||
          callArgument.type === 'SpreadElement' ||
          !isExpressionNode(callArgument)
        ) {
          unsupported = true;
          continue;
        }
        forwarded.push(callArgument);
      }
    }
    return {
      expressions: forwarded,
      ...(unsupported
        ? { reason: 'class helper forwarding is only partially statically supported' }
        : {}),
    };
  }

  async #resolveStyleDefinition(
    input: Expression,
    module: ParsedModule,
    scope: Scope,
    state: RequestState,
    depth: number,
    seen: Set<Binding>,
  ): Promise<StyleResolution> {
    if (depth > MAX_STYLE_DEPTH) {
      return { reason: 'style provenance traversal limit reached' };
    }
    const expression = unwrapExpression(input);
    if (expression.type === 'Identifier') {
      const binding = resolveBinding(scope, expression.name);
      if (binding === undefined || seen.has(binding)) {
        return { reason: 'style binding could not be resolved statically' };
      }
      seen.add(binding);
      const followed = await this.#followBinding(module, binding, state, depth + 1);
      if ('reason' in followed) return { reason: followed.reason };
      const initializer = followed.binding.initializer;
      if (initializer == null) {
        return { reason: 'style binding has no statically supported initializer' };
      }
      return this.#resolveStyleDefinition(
        initializer,
        followed.module,
        followed.module.scopes.get(initializer) ?? followed.binding.scope,
        state,
        depth + 1,
        seen,
      );
    }
    if (
      expression.type !== 'MemberExpression' ||
      expression.optional === true ||
      expression.object.type === 'Super'
    ) {
      return { reason: 'style expression is not a static binding member' };
    }
    const property = staticMemberName(expression);
    if (property === undefined) {
      return { reason: 'computed style member is not statically supported' };
    }
    const sheet = await this.#resolveStyleSheet(
      expression.object,
      module,
      scope,
      state,
      depth + 1,
      seen,
    );
    if ('reason' in sheet) return { reason: sheet.reason };
    const definition = definiteObjectProperty(sheet.object, property);
    return definition === undefined
      ? { reason: `stylex.create has no static ${property} declaration` }
      : { definition: { module: sheet.module, node: definition } };
  }

  async #resolveStyleSheet(
    input: Expression,
    module: ParsedModule,
    scope: Scope,
    state: RequestState,
    depth: number,
    seen: Set<Binding>,
  ): Promise<
    | { readonly module: ParsedModule; readonly object: ObjectExpression }
    | { readonly reason: string }
  > {
    if (depth > MAX_STYLE_DEPTH) {
      return { reason: 'style provenance traversal limit reached' };
    }
    const expression = unwrapExpression(input);
    if (expression.type === 'CallExpression') {
      if (!isStylexCall(expression, 'create', module, scope)) {
        return { reason: 'style sheet is not created by the bound stylex.create' };
      }
      const argument = expression.arguments[0];
      return argument?.type === 'ObjectExpression'
        ? { module, object: argument }
        : { reason: 'stylex.create argument is not a static object literal' };
    }
    if (expression.type === 'Identifier') {
      const binding = resolveBinding(scope, expression.name);
      if (binding === undefined || seen.has(binding)) {
        return { reason: 'style sheet binding could not be resolved statically' };
      }
      seen.add(binding);
      const followed = await this.#followBinding(module, binding, state, depth + 1);
      if ('reason' in followed) return followed;
      const initializer = followed.binding.initializer;
      if (initializer == null) {
        return { reason: 'style sheet binding has no static initializer' };
      }
      return this.#resolveStyleSheet(
        initializer,
        followed.module,
        followed.module.scopes.get(initializer) ?? followed.binding.scope,
        state,
        depth + 1,
        seen,
      );
    }
    if (
      expression.type === 'MemberExpression' &&
      expression.object.type === 'Identifier'
    ) {
      const namespace = resolveBinding(scope, expression.object.name);
      const exported = staticMemberName(expression);
      if (
        namespace?.import?.kind === 'namespace' &&
        !isStylexPackageImport(namespace.import) &&
        exported !== undefined
      ) {
        const imported = await this.#resolveImport(
          namespace.import.source,
          module,
          state,
        );
        if ('reason' in imported) return imported;
        const target = await this.#exportedBinding(
          imported.module,
          exported,
          state,
          depth + 1,
        );
        if ('reason' in target) return target;
        const initializer = target.binding.initializer;
        if (initializer == null) {
          return { reason: 'imported style sheet has no static initializer' };
        }
        return this.#resolveStyleSheet(
          initializer,
          target.module,
          target.module.scopes.get(initializer) ?? target.binding.scope,
          state,
          depth + 1,
          seen,
        );
      }
    }
    return { reason: 'style sheet expression is not statically supported' };
  }

  async #followBinding(
    module: ParsedModule,
    binding: Binding,
    state: RequestState,
    depth: number,
  ): Promise<ResolvedBinding | { readonly reason: string }> {
    if (
      binding.declaration.type === 'VariableDeclaration' &&
      binding.declaration.kind !== 'const'
    ) {
      return { reason: 'mutable style bindings are not resolved statically' };
    }
    if (binding.import === undefined) return { module, binding };
    if (isStylexPackageImport(binding.import)) {
      return { reason: 'stylex library binding is not a project style declaration' };
    }
    if (binding.import.kind === 'namespace') {
      return { reason: 'namespace import requires a static member' };
    }
    const imported = await this.#resolveImport(binding.import.source, module, state);
    if ('reason' in imported) return imported;
    return this.#exportedBinding(
      imported.module,
      binding.import.imported,
      state,
      depth + 1,
    );
  }

  async #exportedBinding(
    module: ParsedModule,
    exported: string,
    state: RequestState,
    depth: number,
  ): Promise<ResolvedBinding | { readonly reason: string }> {
    if (depth > MAX_STYLE_DEPTH) {
      return { reason: 'style import graph traversal limit reached' };
    }
    const target = module.exports.get(exported);
    if (target === undefined) {
      return { reason: `project style import has no static ${exported} export` };
    }
    if (target.kind === 'reexport') {
      const imported = await this.#resolveImport(target.source, module, state);
      return 'reason' in imported
        ? imported
        : this.#exportedBinding(imported.module, target.imported, state, depth + 1);
    }
    const binding = module.rootScope.bindings.get(target.local);
    if (
      binding?.declaration.type === 'VariableDeclaration' &&
      binding.declaration.kind !== 'const'
    ) {
      return { reason: 'mutable style bindings are not resolved statically' };
    }
    return binding === undefined
      ? { reason: `project style export ${exported} has no static binding` }
      : { module, binding };
  }

  async #resolveImport(
    specifier: string,
    importer: ParsedModule,
    state: RequestState,
  ): Promise<ResolvedImport> {
    if (this.#resolver === undefined) {
      return { reason: 'Vite project import resolver is unavailable' };
    }
    const key = `${importer.path}\u0000${specifier}`;
    let pending = state.importResolutions.get(key);
    if (pending === undefined) {
      pending = (async (): Promise<ResolvedImport> => {
        let id: string | undefined;
        try {
          id = await this.#resolver?.(specifier, importer.path);
        } catch {
          return { reason: 'Vite could not resolve the project style import' };
        }
        if (id === undefined) {
          return { reason: 'Vite could not resolve the project style import' };
        }
        const normalized = normalizeModuleId(id, this.#root);
        if (normalized === undefined) {
          return { reason: 'resolved style import is not a project source file' };
        }
        let canonical: string;
        try {
          canonical = await realpath(normalized);
        } catch {
          return { reason: 'resolved style import is unavailable' };
        }
        if (!isAllowedSourcePath(this.#root, canonical)) {
          return {
            reason: 'resolved style import is outside the project source allowlist',
          };
        }
        if (
          !state.visitedModules.has(canonical) &&
          state.visitedModules.size >= MAX_STYLE_MODULES
        ) {
          return { reason: 'style import graph module limit reached' };
        }
        state.visitedModules.add(canonical);
        const loaded = await this.#loadModule(canonical, state);
        return loaded === undefined
          ? { reason: 'resolved style import could not be parsed safely' }
          : { module: loaded };
      })();
      state.importResolutions.set(key, pending);
    }
    return pending;
  }
}

const validSourceInput = (source: Record<string, unknown>): boolean => {
  if (
    typeof source.file !== 'string' ||
    source.file.length === 0 ||
    source.file.length > 512 ||
    source.file.includes('\\') ||
    source.file.includes('\0') ||
    isAbsolute(source.file) ||
    source.file
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..') ||
    isCredentialPath(source.file) ||
    typeof source.view !== 'string' ||
    source.view.length === 0 ||
    source.view.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(source.view)
  ) {
    return false;
  }
  for (const key of ['line', 'column', 'endLine', 'endColumn'] as const) {
    const value = source[key];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10_000_000)
    ) {
      return false;
    }
  }
  if (
    source.revision !== undefined &&
    (typeof source.revision !== 'string' || !/^[a-f\d]{64}$/u.test(source.revision))
  ) {
    return false;
  }
  const line = source.line;
  const column = source.column;
  const endLine = source.endLine;
  const endColumn = source.endColumn;
  return !(
    typeof line === 'number' &&
    typeof column === 'number' &&
    typeof endLine === 'number' &&
    typeof endColumn === 'number' &&
    (endLine < line || (endLine === line && endColumn < column))
  );
};

const validAutomaticReference = (
  reference: AutomaticSourceReference,
  code: string,
  file: string,
  revision: string,
): boolean => {
  const source = reference.source;
  if (
    source.file !== file ||
    source.revision !== revision ||
    typeof source.line !== 'number' ||
    typeof source.column !== 'number' ||
    typeof source.endLine !== 'number' ||
    typeof source.endColumn !== 'number' ||
    !Number.isInteger(reference.start) ||
    !Number.isInteger(reference.end) ||
    reference.start < 0 ||
    reference.end < reference.start ||
    reference.end > code.length ||
    reference.snippetStart < reference.start ||
    reference.snippetEnd < reference.snippetStart ||
    reference.snippetEnd > reference.end
  ) {
    return false;
  }
  if (
    (reference.attributesStart === undefined) !==
      (reference.attributesEnd === undefined) ||
    (reference.attributesStart !== undefined &&
      (reference.attributesStart < reference.start ||
        reference.attributesEnd === undefined ||
        reference.attributesEnd < reference.attributesStart ||
        reference.attributesEnd > reference.end))
  ) {
    return false;
  }
  const starts = lineStarts(code);
  return (
    offsetAt(starts, source.line, source.column, code.length) === reference.start &&
    offsetAt(starts, source.endLine, source.endColumn, code.length) === reference.end
  );
};

const lineStarts = (code: string): ReadonlyArray<number> => {
  const starts = [0];
  const newline = /\r\n|[\n\r\u2028\u2029]/gu;
  for (const match of code.matchAll(newline)) {
    if (match.index !== undefined) starts.push(match.index + match[0].length);
  }
  return starts;
};

const offsetAt = (
  starts: ReadonlyArray<number>,
  line: number,
  column: number,
  length: number,
): number | undefined => {
  const start = starts[line - 1];
  if (start === undefined) return undefined;
  const offset = start + column - 1;
  const next = starts[line];
  const maximum = next === undefined ? length : next;
  return offset >= start && offset <= maximum ? offset : undefined;
};

const normalizeModuleId = (id: string, root: string): string | undefined => {
  if (id.includes('\0') || id.startsWith('virtual:')) return undefined;
  const clean = id.split(/[?#]/u, 1)[0];
  if (clean === undefined || clean === '') return undefined;
  let path: string;
  try {
    path = clean.startsWith('file:')
      ? fileURLToPath(clean)
      : isAbsolute(clean)
        ? clean
        : resolve(root, clean);
  } catch {
    return undefined;
  }
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) ? resolve(path) : undefined;
};

const isAllowedSourcePath = (root: string, path: string): boolean => {
  const projectRelative = relative(root, path);
  if (
    projectRelative === '' ||
    projectRelative === '..' ||
    projectRelative.startsWith(`..${sep}`) ||
    isAbsolute(projectRelative)
  ) {
    return false;
  }
  const parts = projectRelative.split(sep);
  return (
    !parts.some((part) =>
      ['.git', '.creasekit', 'node_modules'].includes(part.toLowerCase()),
    ) &&
    !isCredentialPath(projectRelative) &&
    SOURCE_EXTENSIONS.has(extname(path).toLowerCase())
  );
};

const isCredentialPath = (path: string): boolean => {
  const name = basename(path).toLowerCase();
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    ['.git-credentials', '.netrc', '.npmrc', '.pypirc'].includes(name) ||
    /(?:^|[-_.])(?:credential|credentials|secret|secrets|private[-_.]?key)(?:[-_.]|$)/u.test(
      name,
    ) ||
    /\.(?:key|p12|pfx|pem)$/u.test(name)
  );
};

const projectFile = (root: string, path: string): string | undefined => {
  if (!isAllowedSourcePath(root, path)) return undefined;
  return relative(root, path).split(sep).join('/');
};

const loadModule = async (
  root: string,
  requestedPath: string,
): Promise<ParsedModule | undefined> => {
  let canonical: string;
  try {
    canonical = await realpath(requestedPath);
  } catch {
    return undefined;
  }
  if (canonical !== requestedPath || !isAllowedSourcePath(root, canonical)) {
    return undefined;
  }
  let handle;
  try {
    handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SOURCE_FILE_BYTES) return undefined;
    const bytes = await handle.readFile();
    const after = await realpath(canonical);
    if (after !== canonical) return undefined;
    const code = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const file = projectFile(root, canonical);
    if (file === undefined) return undefined;
    const ast = parse(code, {
      allowAwaitOutsideFunction: true,
      plugins: parserPlugins(extname(canonical).toLowerCase()),
      sourceFilename: file,
      sourceType: 'unambiguous',
    });
    if (ast.program.sourceType !== 'module') return undefined;
    const analysis = analyzeModule(ast.program);
    return {
      path: canonical,
      file,
      code,
      revision: sha256(bytes),
      program: ast.program,
      rootScope: analysis.rootScope,
      scopes: analysis.scopes,
      exports: analysis.exports,
      redactions: collectRedactions(ast.program),
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

const parserPlugins = (extension: string): Array<ParserPlugin> => {
  const plugins: Array<ParserPlugin> = ['decorators-legacy'];
  if (['.ts', '.tsx', '.mts', '.cts'].includes(extension)) plugins.push('typescript');
  if (extension === '.jsx' || extension === '.tsx') plugins.push('jsx');
  return plugins;
};

const analyzeModule = (
  program: Program,
): {
  readonly rootScope: Scope;
  readonly scopes: WeakMap<Node, Scope>;
  readonly exports: ReadonlyMap<string, ExportTarget>;
} => {
  const rootScope: Scope = { bindings: new Map() };
  const scopes = new WeakMap<Node, Scope>();

  const addBinding = (
    scope: Scope,
    identifier: Identifier,
    declaration: Node,
    options: Omit<Binding, 'name' | 'scope' | 'declaration'> = {},
  ): void => {
    if (scope.bindings.has(identifier.name)) return;
    scope.bindings.set(identifier.name, {
      name: identifier.name,
      scope,
      declaration,
      ...options,
    });
  };

  const addPattern = (
    pattern: Node,
    scope: Scope,
    declaration: Node,
    options: Omit<Binding, 'name' | 'scope' | 'declaration'> = {},
  ): void => {
    if (pattern.type === 'Identifier') {
      addBinding(scope, pattern, declaration, options);
    } else if (pattern.type === 'AssignmentPattern') {
      addPattern(pattern.left, scope, declaration, options);
    } else if (pattern.type === 'RestElement') {
      addPattern(pattern.argument, scope, declaration, {
        ...options,
        restParameter: true,
      });
    } else if (pattern.type === 'TSParameterProperty') {
      addPattern(pattern.parameter, scope, declaration, options);
    } else if (pattern.type === 'ArrayPattern') {
      for (const item of pattern.elements) {
        if (item !== null) addPattern(item, scope, declaration, options);
      }
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        addPattern(
          property.type === 'RestElement' ? property.argument : property.value,
          scope,
          declaration,
          options,
        );
      }
    }
  };

  const visit = (node: Node, scope: Scope): void => {
    let active = scope;
    if (isFunctionNode(node)) {
      if (node.type === 'FunctionDeclaration' && node.id != null) {
        addBinding(scope, node.id, node, { functionNode: node });
      }
      active = { parent: scope, bindings: new Map() };
      if (node.type === 'FunctionExpression' && node.id != null) {
        addBinding(active, node.id, node, { functionNode: node });
      }
      for (const parameter of node.params) addPattern(parameter, active, parameter);
    } else if (
      node.type === 'BlockStatement' ||
      node.type === 'CatchClause' ||
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'SwitchStatement'
    ) {
      active = { parent: scope, bindings: new Map() };
      if (node.type === 'CatchClause' && node.param != null) {
        addPattern(node.param, active, node.param);
      }
    }
    scopes.set(node, active);

    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        const imported =
          specifier.type === 'ImportSpecifier'
            ? specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value
            : specifier.type === 'ImportDefaultSpecifier'
              ? 'default'
              : '*';
        addBinding(active, specifier.local, node, {
          import: {
            source: node.source.value,
            imported,
            kind:
              specifier.type === 'ImportDefaultSpecifier'
                ? 'default'
                : specifier.type === 'ImportNamespaceSpecifier'
                  ? 'namespace'
                  : 'named',
          },
        });
      }
    } else if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        const initializer = declaration.init;
        addPattern(declaration.id, active, node, {
          ...(initializer == null ? {} : { initializer }),
          ...(initializer != null && isFunctionNode(initializer)
            ? { functionNode: initializer }
            : {}),
        });
      }
    } else if (node.type === 'ClassDeclaration' && node.id != null) {
      addBinding(active, node.id, node);
    }
    forEachChild(node, (child) => visit(child, active));
  };
  visit(program, rootScope);

  const exports = new Map<string, ExportTarget>();
  for (const statement of program.body) {
    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration != null) {
        for (const name of declaredNames(statement.declaration)) {
          exports.set(name, { kind: 'local', local: name });
        }
      }
      for (const specifier of statement.specifiers) {
        if (specifier.type !== 'ExportSpecifier') continue;
        const exported =
          specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : specifier.exported.value;
        const local = specifier.local.name;
        exports.set(
          exported,
          statement.source == null
            ? { kind: 'local', local }
            : { kind: 'reexport', source: statement.source.value, imported: local },
        );
      }
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration;
      if (declaration.type === 'Identifier') {
        exports.set('default', { kind: 'local', local: declaration.name });
      } else if (
        (declaration.type === 'FunctionDeclaration' ||
          declaration.type === 'ClassDeclaration') &&
        declaration.id != null
      ) {
        exports.set('default', { kind: 'local', local: declaration.id.name });
      }
    }
  }
  return { rootScope, scopes, exports };
};

const declaredNames = (node: Node): ReadonlyArray<string> => {
  if (node.type === 'VariableDeclaration') {
    return node.declarations.flatMap((declaration) => patternNames(declaration.id));
  }
  if (
    (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
    node.id != null
  ) {
    return [node.id.name];
  }
  return [];
};

const patternNames = (node: Node): ReadonlyArray<string> => {
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'AssignmentPattern') return patternNames(node.left);
  if (node.type === 'RestElement') return patternNames(node.argument);
  if (node.type === 'ArrayPattern') {
    return node.elements.flatMap((item) => (item === null ? [] : patternNames(item)));
  }
  if (node.type === 'ObjectPattern') {
    return node.properties.flatMap((property) =>
      patternNames(
        property.type === 'RestElement' ? property.argument : property.value,
      ),
    );
  }
  return [];
};

const collectRedactions = (program: Program): ReadonlyArray<Redaction> => {
  const redactions: Array<Redaction> = [];
  walk(program, (node) => {
    let name: string | undefined;
    let value: Node | null | undefined;
    if (node.type === 'VariableDeclarator') {
      name = credentialTargetName(node.id);
      value = node.init;
    } else if (node.type === 'ObjectProperty') {
      name = node.computed ? undefined : credentialTargetName(node.key);
      value = isNode(node.value) ? node.value : undefined;
    } else if (node.type === 'ClassProperty') {
      name = node.computed ? undefined : credentialTargetName(node.key);
      value = node.value;
    } else if (node.type === 'ClassPrivateProperty') {
      name = credentialTargetName(node.key);
      value = node.value;
    } else if (node.type === 'AssignmentExpression') {
      name = credentialTargetName(node.left);
      value = node.right;
    } else if (node.type === 'JSXAttribute') {
      name = credentialTargetName(node.name);
      value = node.value;
    }
    if (
      name !== undefined &&
      CREDENTIAL_NAME.test(name.replaceAll(/[-_\s]/gu, '')) &&
      value?.start != null &&
      value.end != null
    ) {
      redactions.push({ start: value.start, end: value.end });
    }
  });
  redactions.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: Array<Redaction> = [];
  for (const redaction of redactions) {
    const previous = merged.at(-1);
    if (previous !== undefined && redaction.start <= previous.end) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, redaction.end),
      };
    } else {
      merged.push(redaction);
    }
  }
  return merged;
};

const credentialTargetName = (node: Node): string | undefined => {
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  if (
    (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
    !node.computed &&
    node.property.type === 'Identifier'
  ) {
    return node.property.name;
  }
  if (node.type === 'PrivateName') return node.id.name;
  return undefined;
};

const takeSnippet = (
  module: ParsedModule,
  start: number,
  end: number,
  preTruncated: boolean,
  state: RequestState,
): {
  readonly snippet?: string;
  readonly truncated: boolean;
  readonly redacted: boolean;
} => {
  const boundedStart = Math.max(0, Math.min(start, module.code.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, module.code.length));
  const redacted = redactRange(
    module.code,
    boundedStart,
    boundedEnd,
    module.redactions,
  );
  const allowance = Math.max(
    0,
    Math.min(MAX_SOURCE_SNIPPET_CHARS, state.remainingSnippetChars),
  );
  const snippet = allowance === 0 ? undefined : redacted.value.slice(0, allowance);
  if (snippet !== undefined) state.remainingSnippetChars -= snippet.length;
  return {
    ...(snippet === undefined ? {} : { snippet }),
    truncated:
      preTruncated ||
      redacted.redacted ||
      redacted.value.length > allowance ||
      snippet === undefined,
    redacted: redacted.redacted,
  };
};

const redactRange = (
  code: string,
  start: number,
  end: number,
  redactions: ReadonlyArray<Redaction>,
): { readonly value: string; readonly redacted: boolean } => {
  const relevant = redactions.filter(
    (redaction) => redaction.start < end && redaction.end > start,
  );
  if (relevant.length === 0) return { value: code.slice(start, end), redacted: false };
  let cursor = start;
  let value = '';
  for (const redaction of relevant) {
    const redactionStart = Math.max(start, redaction.start);
    const redactionEnd = Math.min(end, redaction.end);
    if (redactionStart > cursor) value += code.slice(cursor, redactionStart);
    value += REDACTION_MARKER;
    cursor = Math.max(cursor, redactionEnd);
  }
  if (cursor < end) value += code.slice(cursor, end);
  return { value, redacted: true };
};

const findExpression = (
  program: Program,
  start: number,
  end: number,
): Expression | undefined => {
  let found: Expression | undefined;
  walk(program, (node) => {
    if (
      found === undefined &&
      node.start === start &&
      node.end === end &&
      isExpressionNode(node)
    ) {
      found = node;
    }
  });
  return found;
};

const isStylexCall = (
  call: CallExpression,
  method: 'create' | 'props',
  module: ParsedModule,
  scope: Scope,
): boolean => {
  const callee = unwrapExpression(call.callee);
  if (callee.type === 'Identifier') {
    const binding = resolveBinding(scope, callee.name);
    return bindingTargetsStylexNamed(binding, method, module, new Set());
  }
  if (
    callee.type !== 'MemberExpression' ||
    callee.object.type !== 'Identifier' ||
    staticMemberName(callee) !== method
  ) {
    return false;
  }
  const binding = resolveBinding(scope, callee.object.name);
  return bindingTargetsStylexNamespace(binding, module, new Set());
};

const bindingTargetsStylexNamed = (
  binding: Binding | undefined,
  method: 'create' | 'props',
  module: ParsedModule,
  seen: Set<Binding>,
): boolean => {
  if (binding === undefined || seen.has(binding)) return false;
  seen.add(binding);
  if (
    binding.import?.source === '@stylexjs/stylex' &&
    binding.import.kind === 'named' &&
    binding.import.imported === method
  ) {
    return true;
  }
  const initializer = binding.initializer;
  if (initializer == null) return false;
  const expression = unwrapExpression(initializer);
  if (expression.type === 'Identifier') {
    return bindingTargetsStylexNamed(
      resolveBinding(module.scopes.get(expression) ?? binding.scope, expression.name),
      method,
      module,
      seen,
    );
  }
  if (
    expression.type === 'MemberExpression' &&
    expression.object.type === 'Identifier' &&
    staticMemberName(expression) === method
  ) {
    return bindingTargetsStylexNamespace(
      resolveBinding(
        module.scopes.get(expression) ?? binding.scope,
        expression.object.name,
      ),
      module,
      seen,
    );
  }
  return false;
};

const bindingTargetsStylexNamespace = (
  binding: Binding | undefined,
  module: ParsedModule,
  seen: Set<Binding>,
): boolean => {
  if (binding === undefined || seen.has(binding)) return false;
  seen.add(binding);
  if (
    binding.import?.source === '@stylexjs/stylex' &&
    (binding.import.kind === 'namespace' || binding.import.kind === 'default')
  ) {
    return true;
  }
  const initializer = binding.initializer;
  if (initializer == null) return false;
  const expression = unwrapExpression(initializer);
  return (
    expression.type === 'Identifier' &&
    bindingTargetsStylexNamespace(
      resolveBinding(module.scopes.get(expression) ?? binding.scope, expression.name),
      module,
      seen,
    )
  );
};

const returnedStylexPropsCalls = (
  fn: BabelFunction,
  module: ParsedModule,
  scope: Scope,
): ReadonlyArray<CallExpression> => {
  const returns: Array<Expression> = [];
  if (fn.body.type !== 'BlockStatement') {
    returns.push(fn.body);
  } else {
    const visit = (node: Node): void => {
      if (node !== fn.body && isFunctionNode(node)) return;
      if (node.type === 'ReturnStatement' && node.argument != null) {
        returns.push(node.argument);
        return;
      }
      forEachChild(node, visit);
    };
    visit(fn.body);
  }
  const calls: Array<CallExpression> = [];
  for (const returned of returns) {
    const visit = (node: Node, parent?: Node): void => {
      if (
        node.type === 'CallExpression' &&
        parent?.type === 'MemberExpression' &&
        parent.object === node &&
        staticMemberName(parent) === 'className' &&
        isStylexCall(node, 'props', module, module.scopes.get(node) ?? scope)
      ) {
        calls.push(node);
      }
      forEachChild(node, (child) => visit(child, node));
    };
    visit(returned);
  }
  return calls;
};

const parameterDescriptor = (
  node: Node,
): { readonly name: string; readonly rest: boolean } | undefined => {
  if (node.type === 'Identifier') return { name: node.name, rest: false };
  if (node.type === 'AssignmentPattern' && node.left.type === 'Identifier') {
    return { name: node.left.name, rest: false };
  }
  if (node.type === 'RestElement' && node.argument.type === 'Identifier') {
    return { name: node.argument.name, rest: true };
  }
  if (node.type === 'TSParameterProperty') return parameterDescriptor(node.parameter);
  return undefined;
};

const definiteObjectProperty = (
  object: ObjectExpression,
  name: string,
): ObjectMethod | ObjectProperty | undefined => {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const property = object.properties[index];
    if (property === undefined || property.type === 'SpreadElement') continue;
    if (!property.computed && propertyKeyName(property.key) === name) return property;
  }
  return undefined;
};

const staticMemberName = (node: {
  readonly computed: boolean;
  readonly property: Node;
}): string | undefined => {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'StringLiteral') {
    return node.property.value;
  }
  return undefined;
};

const propertyKeyName = (node: Node): string | undefined => {
  if (node.type === 'Identifier' || node.type === 'StringLiteral') {
    return node.type === 'Identifier' ? node.name : node.value;
  }
  return undefined;
};

const spanForNode = (module: ParsedModule, node: Node, view: string): SourceSpan => ({
  file: module.file,
  view: boundedLabel(view),
  line: node.loc?.start.line ?? 1,
  column: (node.loc?.start.column ?? 0) + 1,
  endLine: node.loc?.end.line ?? node.loc?.start.line ?? 1,
  endColumn: (node.loc?.end.column ?? node.loc?.start.column ?? 0) + 1,
  revision: module.revision,
});

const expressionLabel = (node: Node, code: string): string => {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    const path = staticExpressionPath(node);
    if (path !== undefined) return boundedLabel(path);
  }
  if (node.type === 'CallExpression') {
    const callee =
      node.callee.type === 'Super' || node.callee.type === 'V8IntrinsicIdentifier'
        ? undefined
        : staticExpressionPath(node.callee);
    return callee === undefined ? '(dynamic style call)' : boundedLabel(`${callee}(…)`);
  }
  if (node.type === 'ArrayExpression') return '(style array)';
  if (node.type === 'ObjectExpression') return '(inline style object)';
  const start = node.start;
  const end = node.end;
  if (start == null || end == null) return '(style expression)';
  const literal = code.slice(start, Math.min(end, start + 120));
  return CREDENTIAL_NAME.test(literal)
    ? '(redacted style expression)'
    : boundedLabel(literal);
};

const staticExpressionPath = (input: Node): string | undefined => {
  const node = isExpressionNode(input) ? unwrapExpression(input) : input;
  if (node.type === 'Identifier') return node.name;
  if (
    node.type !== 'MemberExpression' ||
    node.object.type === 'Super' ||
    node.optional === true
  ) {
    return undefined;
  }
  const owner = staticExpressionPath(node.object);
  const property = staticMemberName(node);
  return owner === undefined || property === undefined
    ? undefined
    : `${owner}.${property}`;
};

const resolveBinding = (scope: Scope, name: string): Binding | undefined => {
  let current: Scope | undefined = scope;
  while (current !== undefined) {
    const binding = current.bindings.get(name);
    if (binding !== undefined) return binding;
    current = current.parent;
  }
  return undefined;
};

const isStylexPackageImport = (binding: ImportBinding | undefined): boolean =>
  binding?.source === '@stylexjs/stylex';

function unwrapExpression(node: Expression): Expression;
function unwrapExpression(node: Node): Node;
function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TypeCastExpression' ||
    current.type === 'TSInstantiationExpression'
  ) {
    current = current.expression;
  }
  return current.type === 'ParenthesizedExpression'
    ? unwrapExpression(current.expression)
    : current;
}

const isFunctionNode = (node: Node): node is BabelFunction =>
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression' ||
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'ObjectMethod' ||
  node.type === 'ClassMethod' ||
  node.type === 'ClassPrivateMethod';

const isExpressionNode = (node: Node): node is Expression =>
  node.type !== 'ArrayPattern' &&
  node.type !== 'AssignmentPattern' &&
  node.type !== 'ObjectPattern' &&
  node.type !== 'RestElement' &&
  node.type !== 'VoidPattern';

const forEachChild = (node: Node, visit: (child: Node) => void): void => {
  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'innerComments' ||
      key === 'trailingComments' ||
      key === 'comments' ||
      key === 'errors' ||
      key === 'tokens'
    ) {
      continue;
    }
    if (isNode(value)) {
      visit(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) visit(item);
      }
    }
  }
};

const walk = (node: Node, visit: (node: Node) => void): void => {
  visit(node);
  forEachChild(node, (child) => walk(child, visit));
};

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string';

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean => Object.keys(value).every((key) => allowed.has(key));

const sourceKey = (source: SourceSpan): string =>
  JSON.stringify([
    source.file,
    source.view,
    source.line,
    source.column,
    source.endLine,
    source.endColumn,
    source.revision,
  ]);

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const boundedLabel = (value: string): string =>
  value.length <= 120 ? value : `${value.slice(0, 119)}…`;
