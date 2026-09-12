import { Schema } from 'effect';

import { AgentSelection as AgentSelectionSchema } from './agent-contract.js';
import type { AgentSnapshot } from './agent-contract.js';
import type { Annotation } from './domain.js';
import type { FoldkitContext } from './foldkit-schema.js';
import { SourceEvidence as SourceEvidenceSchema } from './source-schema.js';
import type { SourceEvidence, SourceSpan } from './source-schema.js';

export const SOURCE_CONTEXT_PATH = '/__creasekit/source-context';
export const SOURCE_CONTEXT_BATCH_SIZE = 64;
export const SOURCE_CONTEXT_TIMEOUT_MS = 3_000;
export const SOURCE_CONTEXT_RESPONSE_MAX_BYTES = 256 * 1024;
export const SOURCE_EVIDENCE_SNAPSHOT_MAX_BYTES = 112 * 1024;
export const SOURCE_EVIDENCE_BRIDGE_MAX_BYTES = 128 * 1024;

const SOURCE_CONTEXT_MAX_TIMEOUT_MS = 10_000;
const SOURCE_EVIDENCE_LIMIT_REASON =
  'Source literal evidence was limited to keep this agent snapshot within the bridge size limit.';

const SourceContextResponse = Schema.Struct({
  sources: Schema.Array(SourceEvidenceSchema),
});

type SourceStyle = NonNullable<SourceEvidence['styles']>[number];
type SourceDefinition = NonNullable<SourceStyle['definition']>;
type AgentSelection = typeof AgentSelectionSchema.Type;

export interface SourceEvidenceOptions {
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const isAutomaticSource = (context: FoldkitContext, source: SourceEvidence): boolean =>
  context.provenance === 'automatic-instrumentation' &&
  source.revision !== undefined &&
  source.revision.length > 0;

const sourceReference = (source: SourceEvidence): SourceSpan => ({
  file: source.file,
  view: source.view,
  ...(source.line === undefined ? {} : { line: source.line }),
  ...(source.column === undefined ? {} : { column: source.column }),
  ...(source.endLine === undefined ? {} : { endLine: source.endLine }),
  ...(source.endColumn === undefined ? {} : { endColumn: source.endColumn }),
  ...(source.revision === undefined ? {} : { revision: source.revision }),
});

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

const sameSourceReference = (expected: SourceSpan, received: SourceEvidence): boolean =>
  expected.file === received.file &&
  expected.view === received.view &&
  expected.line === received.line &&
  expected.column === received.column &&
  expected.endLine === received.endLine &&
  expected.endColumn === received.endColumn &&
  expected.revision === received.revision;

const sourceEntries = (context: FoldkitContext): ReadonlyArray<SourceEvidence> => [
  context.source,
  ...(context.elementSource === undefined ? [] : [context.elementSource]),
  ...(context.modelSource?.definition === undefined
    ? []
    : [context.modelSource.definition]),
  ...(context.calls?.map((call) => call.source) ?? []),
  ...(context.layout?.flatMap((layout) =>
    layout.source === undefined ? [] : [layout.source],
  ) ?? []),
];

const collectSources = (
  contexts: ReadonlyArray<FoldkitContext | undefined>,
): ReadonlyArray<SourceEvidence> => {
  const sources = new Map<string, SourceEvidence>();
  for (const context of contexts) {
    if (context === undefined) continue;
    for (const source of sourceEntries(context)) {
      if (!isAutomaticSource(context, source)) continue;
      sources.set(sourceKey(sourceReference(source)), source);
    }
  }
  return [...sources.values()];
};

const unavailableDefinition = (definition: SourceDefinition): SourceDefinition => ({
  ...definition,
  status: 'unavailable',
});

const staleDefinition = (definition: SourceDefinition): SourceDefinition => ({
  ...definition,
  status: 'stale',
});

const styleKey = (style: SourceStyle): string =>
  JSON.stringify([style.expression, sourceKey(style.use)]);

const staleStyles = (styles: ReadonlyArray<SourceStyle>): ReadonlyArray<SourceStyle> =>
  styles.map((style) => ({
    ...style,
    ...(style.definition === undefined
      ? {}
      : { definition: staleDefinition(style.definition) }),
  }));

const reconcileStyles = (
  captured: ReadonlyArray<SourceStyle> | undefined,
  hydrated: ReadonlyArray<SourceStyle> | undefined,
): ReadonlyArray<SourceStyle> | undefined => {
  if (captured === undefined) return hydrated;
  if (hydrated === undefined) return staleStyles(captured);

  const previous = new Map(captured.map((style) => [styleKey(style), style]));
  const reconciled = hydrated.map((style) => {
    const capturedStyle = previous.get(styleKey(style));
    const capturedDefinition = capturedStyle?.definition;
    if (
      capturedDefinition?.revision === undefined ||
      capturedDefinition.revision === style.definition?.revision
    )
      return style;
    return {
      ...style,
      definition: staleDefinition(capturedDefinition),
    };
  });
  const current = new Set(hydrated.map(styleKey));
  return [
    ...reconciled,
    ...captured
      .filter((style) => !current.has(styleKey(style)))
      .map((style) => ({
        ...style,
        ...(style.definition === undefined
          ? {}
          : { definition: staleDefinition(style.definition) }),
      })),
  ];
};

const unavailableSource = (source: SourceEvidence): SourceEvidence => ({
  ...source,
  status: 'unavailable',
  ...(source.styles === undefined
    ? {}
    : {
        styles: source.styles.map((style) => ({
          ...style,
          ...(style.definition === undefined
            ? {}
            : { definition: unavailableDefinition(style.definition) }),
        })),
      }),
});

const mergeSource = (
  captured: SourceEvidence,
  hydrated: SourceEvidence,
): SourceEvidence => {
  if (hydrated.status === 'unavailable') return unavailableSource(captured);
  if (hydrated.status === 'stale')
    return {
      ...hydrated,
      ...(captured.snippet === undefined
        ? {}
        : {
            snippet: captured.snippet,
            ...(captured.snippetTruncated === undefined
              ? {}
              : { snippetTruncated: captured.snippetTruncated }),
          }),
      ...(captured.styles === undefined
        ? {}
        : { styles: staleStyles(captured.styles) }),
    };

  const styles = reconcileStyles(captured.styles, hydrated.styles);
  return {
    ...hydrated,
    ...(styles === undefined ? {} : { styles }),
  };
};

const byteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const responseContentType = (response: Response): string | undefined =>
  response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();

const boundedTimeout = (options: SourceEvidenceOptions): number =>
  Math.min(
    Math.max(options.timeoutMs ?? SOURCE_CONTEXT_TIMEOUT_MS, 1),
    SOURCE_CONTEXT_MAX_TIMEOUT_MS,
  );

const boundedResponseBytes = (options: SourceEvidenceOptions): number =>
  Math.min(
    Math.max(options.maxResponseBytes ?? SOURCE_CONTEXT_RESPONSE_MAX_BYTES, 1),
    SOURCE_CONTEXT_RESPONSE_MAX_BYTES,
  );

const sourceResponse = async (
  sources: ReadonlyArray<SourceSpan>,
  options: SourceEvidenceOptions,
): Promise<ReadonlyArray<SourceEvidence>> => {
  if (sources.length > SOURCE_CONTEXT_BATCH_SIZE)
    throw new Error('source context batch exceeds its limit');

  const request = options.fetch ?? globalThis.fetch;
  if (typeof request !== 'function')
    throw new Error('source context fetch is unavailable');

  const controller = new AbortController();
  const timeoutMs = boundedTimeout(options);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('source context request timed out'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      request(options.endpoint ?? SOURCE_CONTEXT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources }),
        credentials: 'same-origin',
        keepalive: false,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    if (!response.ok)
      throw new Error(`source context request failed (${response.status})`);
    if (responseContentType(response) !== 'application/json')
      throw new Error('source context returned an invalid response');

    const contentLength = response.headers.get('content-length');
    const maxResponseBytes = boundedResponseBytes(options);
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length < 0 || length > maxResponseBytes)
        throw new Error('source context response exceeds its limit');
    }

    const body = await Promise.race([response.text(), timeoutPromise]);
    if (byteLength(body) > maxResponseBytes)
      throw new Error('source context response exceeds its limit');

    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new Error('source context returned an invalid response');
    }

    let result: typeof SourceContextResponse.Type;
    try {
      result = Schema.decodeUnknownSync(SourceContextResponse)(input);
    } catch {
      throw new Error('source context returned an invalid response');
    }

    if (result.sources.length !== sources.length)
      throw new Error('source context returned an invalid response');
    for (const [index, source] of result.sources.entries()) {
      const expected = sources[index];
      if (expected === undefined || !sameSourceReference(expected, source))
        throw new Error('source context returned an invalid response');
    }
    return result.sources;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const hydrateSources = async (
  sources: ReadonlyArray<SourceEvidence>,
  options: SourceEvidenceOptions,
): Promise<ReadonlyMap<string, SourceEvidence>> => {
  const batches: Array<ReadonlyArray<SourceEvidence>> = [];
  for (let start = 0; start < sources.length; start += SOURCE_CONTEXT_BATCH_SIZE)
    batches.push(sources.slice(start, start + SOURCE_CONTEXT_BATCH_SIZE));

  const hydrated = new Map<string, SourceEvidence>();
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const result = await sourceResponse(batch.map(sourceReference), options);
        for (const [index, source] of result.entries()) {
          const captured = batch[index];
          if (captured === undefined) continue;
          hydrated.set(sourceKey(sourceReference(captured)), source);
        }
      } catch {
        return;
      }
    }),
  );
  return hydrated;
};

const hydratedSource = (
  context: FoldkitContext,
  source: SourceEvidence,
  sources: ReadonlyMap<string, SourceEvidence>,
): SourceEvidence => {
  if (!isAutomaticSource(context, source)) return source;
  const hydrated = sources.get(sourceKey(sourceReference(source)));
  return hydrated === undefined
    ? unavailableSource(source)
    : mergeSource(source, hydrated);
};

const hydrateContext = (
  context: FoldkitContext,
  sources: ReadonlyMap<string, SourceEvidence>,
): FoldkitContext => {
  if (context.provenance !== 'automatic-instrumentation') return context;

  const source = hydratedSource(context, context.source, sources);
  const elementSource =
    context.elementSource === undefined
      ? undefined
      : hydratedSource(context, context.elementSource, sources);
  const modelSource =
    context.modelSource?.definition === undefined
      ? context.modelSource
      : {
          ...context.modelSource,
          definition: hydratedSource(context, context.modelSource.definition, sources),
        };
  const calls = context.calls?.map((call) => ({
    ...call,
    source: hydratedSource(context, call.source, sources),
  }));
  const layout = context.layout?.map((candidate) => ({
    ...candidate,
    ...(candidate.source === undefined
      ? {}
      : { source: hydratedSource(context, candidate.source, sources) }),
  }));

  return {
    ...context,
    source,
    ...(elementSource === undefined ? {} : { elementSource }),
    ...(modelSource === undefined ? {} : { modelSource }),
    ...(calls === undefined ? {} : { calls }),
    ...(layout === undefined ? {} : { layout }),
  };
};

interface EvidenceBudget {
  readonly sourceSnippetLimit: number;
  readonly definitionSnippetLimit: number;
  readonly includeAddedStyles: boolean;
  readonly preserveCapturedLiterals: boolean;
  readonly preserveCapturedStyles: boolean;
}

interface BudgetedSource {
  readonly source: SourceEvidence;
  readonly limited: boolean;
}

const omitEvidenceSnippet = (source: SourceEvidence): SourceEvidence => {
  const { snippet: _snippet, snippetTruncated: _snippetTruncated, ...rest } = source;
  return rest;
};

const omitDefinitionSnippet = (source: SourceDefinition): SourceDefinition => {
  const { snippet: _snippet, snippetTruncated: _snippetTruncated, ...rest } = source;
  return rest;
};

const limitEvidenceSnippet = (
  captured: SourceEvidence | undefined,
  source: SourceEvidence,
  limit: number,
  preserveCaptured: boolean,
): { readonly source: SourceEvidence; readonly limited: boolean } => {
  if (
    source.snippet === undefined ||
    (preserveCaptured && captured?.snippet !== undefined)
  )
    return { source, limited: false };
  if (limit === 0) return { source: omitEvidenceSnippet(source), limited: true };
  if (source.snippet.length <= limit) return { source, limited: false };
  return {
    source: {
      ...source,
      snippet: source.snippet.slice(0, limit),
      snippetTruncated: true,
    },
    limited: true,
  };
};

const limitDefinitionSnippet = (
  captured: SourceDefinition | undefined,
  source: SourceDefinition,
  limit: number,
  preserveCaptured: boolean,
): { readonly source: SourceDefinition; readonly limited: boolean } => {
  if (
    source.snippet === undefined ||
    (preserveCaptured && captured?.snippet !== undefined)
  )
    return { source, limited: false };
  if (limit === 0) return { source: omitDefinitionSnippet(source), limited: true };
  if (source.snippet.length <= limit) return { source, limited: false };
  return {
    source: {
      ...source,
      snippet: source.snippet.slice(0, limit),
      snippetTruncated: true,
    },
    limited: true,
  };
};

const budgetSource = (
  captured: SourceEvidence,
  hydrated: SourceEvidence,
  budget: EvidenceBudget,
): BudgetedSource => {
  const literal = limitEvidenceSnippet(
    captured,
    hydrated,
    budget.sourceSnippetLimit,
    budget.preserveCapturedLiterals,
  );
  if (literal.source.styles === undefined)
    return { source: literal.source, limited: literal.limited };

  const capturedStyles = new Map(
    (captured.styles ?? []).map((style) => [styleKey(style), style]),
  );
  const styles: SourceStyle[] = [];
  let limited = literal.limited;
  for (const style of literal.source.styles) {
    const previous = capturedStyles.get(styleKey(style));
    if (
      (previous === undefined && !budget.includeAddedStyles) ||
      (previous !== undefined && !budget.preserveCapturedStyles)
    ) {
      limited = true;
      continue;
    }
    if (style.definition === undefined) {
      styles.push(style);
      continue;
    }
    const definition = limitDefinitionSnippet(
      previous?.definition,
      style.definition,
      budget.definitionSnippetLimit,
      budget.preserveCapturedLiterals,
    );
    limited ||= definition.limited;
    styles.push({
      ...style,
      definition: definition.source,
    });
  }

  if (styles.length > 0)
    return {
      source: { ...literal.source, styles },
      limited,
    };
  const { styles: _styles, ...withoutStyles } = literal.source;
  return { source: withoutStyles, limited };
};

const budgetContext = (
  captured: FoldkitContext,
  hydrated: FoldkitContext,
  budget: EvidenceBudget,
): { readonly context: FoldkitContext; readonly limited: boolean } => {
  if (hydrated.provenance !== 'automatic-instrumentation')
    return { context: hydrated, limited: false };

  const owner = budgetSource(captured.source, hydrated.source, budget);
  let limited = owner.limited;
  const element =
    hydrated.elementSource === undefined
      ? undefined
      : budgetSource(
          captured.elementSource ?? hydrated.elementSource,
          hydrated.elementSource,
          budget,
        );
  limited ||= element?.limited ?? false;
  const modelDefinition =
    hydrated.modelSource?.definition === undefined
      ? undefined
      : budgetSource(
          captured.modelSource?.definition ?? hydrated.modelSource.definition,
          hydrated.modelSource.definition,
          budget,
        );
  limited ||= modelDefinition?.limited ?? false;
  const modelSource =
    hydrated.modelSource?.definition === undefined
      ? hydrated.modelSource
      : {
          ...hydrated.modelSource,
          definition: modelDefinition?.source ?? hydrated.modelSource.definition,
        };
  const calls = hydrated.calls?.map((call, index) => {
    const source = budgetSource(
      captured.calls?.[index]?.source ?? call.source,
      call.source,
      budget,
    );
    limited ||= source.limited;
    return { ...call, source: source.source };
  });
  const layout = hydrated.layout?.map((candidate, index) => {
    if (candidate.source === undefined) return candidate;
    const source = budgetSource(
      captured.layout?.[index]?.source ?? candidate.source,
      candidate.source,
      budget,
    );
    limited ||= source.limited;
    return { ...candidate, source: source.source };
  });
  const availability = limited
    ? [
        ...(hydrated.availability ?? []),
        ...(hydrated.availability?.includes(SOURCE_EVIDENCE_LIMIT_REASON) === true
          ? []
          : [SOURCE_EVIDENCE_LIMIT_REASON]),
      ]
    : hydrated.availability;
  return {
    context: {
      ...hydrated,
      source: owner.source,
      ...(element === undefined ? {} : { elementSource: element.source }),
      ...(modelSource === undefined ? {} : { modelSource }),
      ...(calls === undefined ? {} : { calls }),
      ...(layout === undefined ? {} : { layout }),
      ...(availability === undefined ? {} : { availability }),
    },
    limited,
  };
};

const snapshotBytes = (snapshot: AgentSnapshot): number =>
  byteLength(JSON.stringify(snapshot));

const budgetSnapshot = (
  captured: AgentSnapshot,
  hydrated: AgentSnapshot,
  budget: EvidenceBudget,
): AgentSnapshot => {
  const annotations = hydrated.annotations.map((annotation, index) => {
    const previous = captured.annotations[index];
    if (annotation.foldkit === undefined || previous?.foldkit === undefined)
      return annotation;
    const context = budgetContext(previous.foldkit, annotation.foldkit, budget);
    return { ...annotation, foldkit: context.context };
  });
  const selection =
    hydrated.selection === null ||
    hydrated.selection.foldkit === undefined ||
    captured.selection?.foldkit === undefined
      ? hydrated.selection
      : {
          ...hydrated.selection,
          foldkit: budgetContext(
            captured.selection.foldkit,
            hydrated.selection.foldkit,
            budget,
          ).context,
        };
  return { ...hydrated, annotations, selection };
};

const withoutSourceLiterals = (source: SourceEvidence): SourceEvidence => {
  const {
    snippet: _snippet,
    snippetTruncated: _snippetTruncated,
    styles: _styles,
    ...reference
  } = source;
  return reference;
};

const withoutContextLiterals = (context: FoldkitContext): FoldkitContext => {
  if (context.provenance !== 'automatic-instrumentation') return context;
  const elementSource =
    context.elementSource === undefined
      ? undefined
      : withoutSourceLiterals(context.elementSource);
  const modelSource =
    context.modelSource?.definition === undefined
      ? context.modelSource
      : {
          ...context.modelSource,
          definition: withoutSourceLiterals(context.modelSource.definition),
        };
  const calls = context.calls?.map((call) => ({
    ...call,
    source: withoutSourceLiterals(call.source),
  }));
  const layout = context.layout?.map((candidate) => ({
    ...candidate,
    ...(candidate.source === undefined
      ? {}
      : { source: withoutSourceLiterals(candidate.source) }),
  }));
  return {
    ...context,
    source: withoutSourceLiterals(context.source),
    ...(elementSource === undefined ? {} : { elementSource }),
    ...(modelSource === undefined ? {} : { modelSource }),
    ...(calls === undefined ? {} : { calls }),
    ...(layout === undefined ? {} : { layout }),
  };
};

const withoutSnapshotLiterals = (snapshot: AgentSnapshot): AgentSnapshot => ({
  ...snapshot,
  annotations: snapshot.annotations.map((annotation) =>
    annotation.foldkit === undefined
      ? annotation
      : {
          ...annotation,
          foldkit: withoutContextLiterals(annotation.foldkit),
        },
  ),
  selection:
    snapshot.selection === null || snapshot.selection.foldkit === undefined
      ? snapshot.selection
      : {
          ...snapshot.selection,
          foldkit: withoutContextLiterals(snapshot.selection.foldkit),
        },
});

const fitSnapshot = (
  captured: AgentSnapshot,
  hydrated: AgentSnapshot,
): AgentSnapshot => {
  const baseline = withoutSnapshotLiterals(captured);
  const baselineBytes = snapshotBytes(baseline);
  if (baselineBytes > SOURCE_EVIDENCE_BRIDGE_MAX_BYTES) return captured;
  if (snapshotBytes(hydrated) <= SOURCE_EVIDENCE_SNAPSHOT_MAX_BYTES) return hydrated;
  const maximumBytes =
    baselineBytes > SOURCE_EVIDENCE_SNAPSHOT_MAX_BYTES
      ? SOURCE_EVIDENCE_BRIDGE_MAX_BYTES
      : SOURCE_EVIDENCE_SNAPSHOT_MAX_BYTES;

  const budgets: ReadonlyArray<EvidenceBudget> = [
    {
      sourceSnippetLimit: 512,
      definitionSnippetLimit: 256,
      includeAddedStyles: true,
      preserveCapturedLiterals: true,
      preserveCapturedStyles: true,
    },
    {
      sourceSnippetLimit: 256,
      definitionSnippetLimit: 128,
      includeAddedStyles: false,
      preserveCapturedLiterals: true,
      preserveCapturedStyles: true,
    },
    {
      sourceSnippetLimit: 0,
      definitionSnippetLimit: 0,
      includeAddedStyles: false,
      preserveCapturedLiterals: true,
      preserveCapturedStyles: true,
    },
    {
      sourceSnippetLimit: 512,
      definitionSnippetLimit: 256,
      includeAddedStyles: false,
      preserveCapturedLiterals: false,
      preserveCapturedStyles: true,
    },
    {
      sourceSnippetLimit: 256,
      definitionSnippetLimit: 128,
      includeAddedStyles: false,
      preserveCapturedLiterals: false,
      preserveCapturedStyles: false,
    },
    {
      sourceSnippetLimit: 0,
      definitionSnippetLimit: 0,
      includeAddedStyles: false,
      preserveCapturedLiterals: false,
      preserveCapturedStyles: false,
    },
  ];
  let fallback: AgentSnapshot | undefined;
  for (const budget of budgets) {
    const limited = budgetSnapshot(captured, hydrated, budget);
    if (snapshotBytes(limited) <= maximumBytes) return limited;
    if (snapshotBytes(limited) <= SOURCE_EVIDENCE_BRIDGE_MAX_BYTES) fallback = limited;
  }
  return fallback ?? baseline;
};

const enrichContexts = async (
  contexts: ReadonlyArray<FoldkitContext | undefined>,
  options: SourceEvidenceOptions,
): Promise<ReadonlyMap<string, SourceEvidence>> =>
  hydrateSources(collectSources(contexts), options);

export const enrichAnnotations = async (
  annotations: ReadonlyArray<Annotation>,
  options: SourceEvidenceOptions = {},
): Promise<ReadonlyArray<Annotation>> => {
  const sources = await enrichContexts(
    annotations.map((annotation) => annotation.foldkit),
    options,
  );
  return annotations.map((annotation) =>
    annotation.foldkit?.provenance !== 'automatic-instrumentation'
      ? annotation
      : { ...annotation, foldkit: hydrateContext(annotation.foldkit, sources) },
  );
};

export const enrichSelection = async (
  selection: AgentSelection | null,
  options: SourceEvidenceOptions = {},
): Promise<AgentSelection | null> => {
  if (selection === null) return null;
  const sources = await enrichContexts([selection.foldkit], options);
  return selection.foldkit?.provenance !== 'automatic-instrumentation'
    ? selection
    : { ...selection, foldkit: hydrateContext(selection.foldkit, sources) };
};

export const enrichSnapshot = async (
  snapshot: AgentSnapshot,
  options: SourceEvidenceOptions = {},
): Promise<AgentSnapshot> => {
  if (
    snapshotBytes(withoutSnapshotLiterals(snapshot)) > SOURCE_EVIDENCE_BRIDGE_MAX_BYTES
  )
    return snapshot;
  const sources = await enrichContexts(
    [
      ...snapshot.annotations.map((annotation) => annotation.foldkit),
      snapshot.selection?.foldkit,
    ],
    options,
  );
  return fitSnapshot(snapshot, {
    ...snapshot,
    annotations: snapshot.annotations.map((annotation) =>
      annotation.foldkit?.provenance !== 'automatic-instrumentation'
        ? annotation
        : { ...annotation, foldkit: hydrateContext(annotation.foldkit, sources) },
    ),
    selection:
      snapshot.selection === null ||
      snapshot.selection.foldkit?.provenance !== 'automatic-instrumentation'
        ? snapshot.selection
        : {
            ...snapshot.selection,
            foldkit: hydrateContext(snapshot.selection.foldkit, sources),
          },
  });
};
