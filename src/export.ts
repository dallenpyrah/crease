import { Schema } from 'effect';

import { type Annotation, AnnotationArray } from './domain.js';
import type { FoldkitContext } from './foldkit-schema.js';
import type { SourceEvidence, SourceSpan } from './source-schema.js';

const MAX_LAYOUT_CANDIDATES = 6;
const MAX_STYLE_CANDIDATES = 8;
const MAX_SOURCE_SNIPPET_CHARS = 4_000;
const MAX_MODEL_HISTORY = 5;

type SourceStyle = NonNullable<SourceEvidence['styles']>[number];
type SourceDefinition = NonNullable<SourceStyle['definition']>;
type LayoutCandidate = NonNullable<FoldkitContext['layout']>[number];

interface MarkdownState {
  readonly sourceSnippets: Set<string>;
  readonly styleDefinitions: Set<string>;
}

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(1);

const plain = (value: string): string =>
  value.replace(/[\r\n]+/gu, ' ').replace(/([\\`*_[\]{}<>])/gu, '\\$1');

const inlineCode = (value: string): string => {
  const content = value.replace(/[\r\n]+/gu, ' ');
  const longestFence = Math.max(
    0,
    ...[...content.matchAll(/`+/gu)].map((match) => match[0].length),
  );
  const fence = '`'.repeat(Math.max(1, longestFence + 1));
  return `${fence}${content}${fence}`;
};

const fenced = (value: string, language = 'text'): string => {
  const content = value.replace(/\r\n?/gu, '\n');
  const longestFence = Math.max(
    0,
    ...[...content.matchAll(/`+/gu)].map((match) => match[0].length),
  );
  const fence = '`'.repeat(Math.max(3, longestFence + 1));
  return `${fence}${language}\n${content}\n${fence}`;
};

const indent = (value: string): string =>
  value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

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

const formatSourceRange = (source: SourceSpan): string => {
  const start = `${plain(source.file)}${source.line === undefined ? '' : `:${source.line}`}${source.column === undefined ? '' : `:${source.column}`}`;
  if (source.endLine === undefined && source.endColumn === undefined) return start;
  const endLine = source.endLine ?? source.line;
  const end = `${endLine === undefined ? '?' : endLine}${source.endColumn === undefined ? '' : `:${source.endColumn}`}`;
  return `${start}–${end}`;
};

const formatSource = (source: SourceSpan): string =>
  `${formatSourceRange(source)} → ${plain(source.view)}`;

const sourceStatus = (source: Pick<SourceEvidence, 'status' | 'snippet'>): string => {
  switch (source.status) {
    case 'current':
      return 'source status: current (revision verified)';
    case 'stale':
      return 'source status: stale (captured evidence may not match the current file)';
    case 'unavailable':
      return source.snippet === undefined
        ? 'source status: unavailable'
        : 'source status: unavailable (captured literal is unverified)';
    default:
      return 'source status: unverified';
  }
};

const boundedSnippet = (
  source: Pick<SourceEvidence, 'snippet' | 'snippetTruncated'>,
) => {
  if (source.snippet === undefined) return undefined;
  if (source.snippet.length <= MAX_SOURCE_SNIPPET_CHARS)
    return { value: source.snippet, truncated: source.snippetTruncated === true };
  return {
    value: source.snippet.slice(0, MAX_SOURCE_SNIPPET_CHARS),
    truncated: true,
  };
};

const literalLines = (
  source: SourceSpan & Pick<SourceEvidence, 'snippet' | 'snippetTruncated' | 'status'>,
  state: MarkdownState,
): ReadonlyArray<string> => {
  const snippet = boundedSnippet(source);
  if (snippet === undefined) return ['source unavailable'];

  const key = `${sourceKey(source)}:${snippet.value}`;
  if (state.sourceSnippets.has(key)) return ['literal snippet shown above'];
  state.sourceSnippets.add(key);
  return [
    ...(snippet.truncated
      ? ['_Literal snippet truncated for capture or export._']
      : []),
    fenced(snippet.value),
  ];
};

const formatStyles = (annotation: Annotation): string => {
  const { styles } = annotation.target;
  return [
    `display: ${plain(styles.display)}`,
    `font: ${plain(styles.fontSize)} ${plain(styles.fontFamily)}`,
    `color: ${plain(styles.color)}`,
    `padding: ${plain(styles.padding)}`,
    `gap: ${plain(styles.gap)}`,
  ].join('; ');
};

const formatLocation = (annotation: Annotation): ReadonlyArray<string> => {
  const location = annotation.target.location;
  if (location === undefined) return [];
  const items = [
    location.pageHeading ?? location.pagePath,
    location.region?.label,
    location.position === undefined
      ? undefined
      : `Item ${location.position.index} of ${location.position.total} (rendered siblings)`,
  ].filter((value): value is string => value !== undefined && value.length > 0);
  return [
    `**Location:** ${items.map(plain).join(' → ')}`,
    ...(location.region === undefined
      ? []
      : [`**Region label evidence:** ${plain(location.region.labelSource)}`]),
    ...(location.current === undefined
      ? []
      : [`**State at capture:** aria-current="${plain(location.current)}"`]),
    ...(location.selected === undefined
      ? []
      : [`**State at capture:** aria-selected="${location.selected}"`]),
  ];
};

const sourceEvidenceLines = (
  label: string,
  source: SourceEvidence,
  state: MarkdownState,
): ReadonlyArray<string> => [
  `**${label}:** ${formatSource(source)} (${sourceStatus(source)})`,
  ...literalLines(source, state),
];

const modelDefinitionLines = (
  definition: SourceEvidence,
  state: MarkdownState,
): ReadonlyArray<string> => [
  `**Model declaration:** ${plain(definition.view)} (${formatSourceRange(definition)}) (${sourceStatus(definition)})`,
  ...literalLines(definition, state),
];

const formatLayout = (candidate: LayoutCandidate): string => {
  const { bounds } = candidate;
  const geometry = `${formatNumber(bounds.x)}px, ${formatNumber(bounds.y)}px (${formatNumber(bounds.width)} × ${formatNumber(bounds.height)}px)`;
  const styles = [
    `display: ${plain(candidate.display)}`,
    `position: ${plain(candidate.position)}`,
    `padding: ${plain(candidate.padding)}`,
    `border: ${plain(candidate.border)}`,
    `gap: ${plain(candidate.gap)}`,
    `overflow: ${plain(candidate.overflow)}`,
    `scroll: ${formatNumber(candidate.scrollLeft)}, ${formatNumber(candidate.scrollTop)}`,
  ].join('; ');
  const source =
    candidate.source === undefined
      ? 'source unavailable'
      : `${formatSource(candidate.source)} (${sourceStatus(candidate.source)})`;
  return `- **${plain(candidate.tag)}:** ${geometry}; ${styles}; source: ${source}`;
};

const layoutKey = (candidate: LayoutCandidate): string =>
  JSON.stringify([
    candidate.tag,
    candidate.source === undefined ? undefined : sourceKey(candidate.source),
    candidate.bounds.x,
    candidate.bounds.y,
    candidate.bounds.width,
    candidate.bounds.height,
  ]);

const layoutLines = (context: FoldkitContext): ReadonlyArray<string> => {
  if (context.layout === undefined || context.layout.length === 0) return [];
  const seen = new Set<string>();
  const candidates: LayoutCandidate[] = [];
  for (const candidate of context.layout) {
    const key = layoutKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length === MAX_LAYOUT_CANDIDATES) break;
  }
  if (candidates.length === 0) return [];
  return [
    '### Parent layout candidates',
    '',
    ...candidates.map(formatLayout),
    ...(context.layout.length > candidates.length
      ? [`_Showing the first ${MAX_LAYOUT_CANDIDATES} captured candidates._`]
      : []),
  ];
};

interface StyleCandidate {
  readonly source: SourceEvidence;
  readonly style: SourceStyle;
}

const styleCandidates = (context: FoldkitContext): ReadonlyArray<StyleCandidate> => {
  const sources = [
    context.elementSource,
    context.source,
    context.modelSource?.definition,
    ...(context.calls?.map((call) => call.source) ?? []),
    ...(context.layout?.flatMap((candidate) =>
      candidate.source === undefined ? [] : [candidate.source],
    ) ?? []),
  ].filter((source): source is SourceEvidence => source !== undefined);
  const candidates: StyleCandidate[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const style of source.styles ?? []) {
      const key = `${sourceKey(source)}:${style.expression}:${sourceKey(style.use)}:${style.definition?.revision ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ source, style });
      if (candidates.length === MAX_STYLE_CANDIDATES) return candidates;
    }
  }
  return candidates;
};

const definitionLines = (
  definition: SourceDefinition,
  state: MarkdownState,
): ReadonlyArray<string> => {
  const key = sourceKey(definition);
  if (state.styleDefinitions.has(key))
    return [
      `  Definition candidate: ${formatSource(definition)} (${sourceStatus(definition)}); literal snippet shown above.`,
    ];
  state.styleDefinitions.add(key);
  return [
    `  Definition candidate: ${formatSource(definition)} (${sourceStatus(definition)})`,
    ...literalLines(definition, state).map(indent),
  ];
};

const styleLines = (
  context: FoldkitContext,
  state: MarkdownState,
): ReadonlyArray<string> => {
  const candidates = styleCandidates(context);
  if (candidates.length === 0) return [];
  return [
    '### Style declaration candidates',
    '',
    ...candidates.flatMap(({ source, style }) => [
      `- **${inlineCode(style.expression)} use:** ${formatSource(style.use)}; observed from ${formatSource(source)} (${sourceStatus(source)})`,
      ...(style.definition === undefined
        ? ['  Definition candidate: source unavailable.']
        : definitionLines(style.definition, state)),
      ...(style.reason === undefined ? [] : [`  Reason: ${plain(style.reason)}`]),
    ]),
    ...(candidates.length === MAX_STYLE_CANDIDATES
      ? [`_Showing at most ${MAX_STYLE_CANDIDATES} style candidates._`]
      : []),
  ];
};

const modelLines = (
  context: FoldkitContext,
  state: MarkdownState,
): ReadonlyArray<string> => {
  if (context.modelSource === undefined) return [];
  const source = context.modelSource;
  return [
    '### Model source',
    '',
    `**Model supplied:** ${plain(source.expression)} (${formatSourceRange({ ...source, view: source.expression })})`,
    ...(source.definition === undefined
      ? []
      : modelDefinitionLines(source.definition, state)),
  ];
};

const callLines = (
  context: FoldkitContext,
  state: MarkdownState,
): ReadonlyArray<string> => {
  if (context.calls === undefined || context.calls.length === 0) return [];
  return [
    '### Observed invocations',
    '',
    ...context.calls
      .slice(0, MAX_LAYOUT_CANDIDATES)
      .flatMap((call) => [
        `**Observed ${call.kind} invocation:** ${formatSource(call.source)} (${sourceStatus(call.source)})`,
        ...literalLines(call.source, state),
      ]),
    ...(context.calls.length > MAX_LAYOUT_CANDIDATES
      ? [`_Showing the first ${MAX_LAYOUT_CANDIDATES} observed invocations._`]
      : []),
  ];
};

const scopedModelLines = (context: FoldkitContext): ReadonlyArray<string> => {
  if (context.model === undefined) return [];
  const model = JSON.stringify(context.model, null, 2);
  return [
    '### Scoped Model (opt-in capture)',
    '',
    fenced(model),
    ...(context.history === undefined || context.history.length === 0
      ? []
      : [
          '**Observed scope updates (not inferred element-to-Command causality):**',
          ...context.history
            .slice(-MAX_MODEL_HISTORY)
            .flatMap((change) => [
              `**${plain(change.message)}:**`,
              fenced(
                `${JSON.stringify(change.before, null, 2)}\n→\n${JSON.stringify(change.after, null, 2)}`,
              ),
            ]),
        ]),
  ];
};

const contextLines = (
  context: FoldkitContext,
  state: MarkdownState,
): ReadonlyArray<string> => [
  '### Owning view',
  '',
  ...sourceEvidenceLines('Source', context.source, state),
  '### FoldKit scope',
  '',
  `**FoldKit scope:** ${plain(context.boundary)} (${context.provenance === 'automatic-instrumentation' ? 'automatic instrumentation' : 'explicit registration'})`,
  ...(context.events.length === 0
    ? ['**Messages:** No static event registered']
    : [
        `**Messages:** ${context.events
          .map((event) => `${plain(event.event)} → ${plain(event.message)}`)
          .join('; ')}`,
      ]),
  ...(context.availability?.map((reason) => `**Context limit:** ${plain(reason)}`) ??
    []),
  ...modelLines(context, state),
  ...callLines(context, state),
  ...layoutLines(context),
  ...styleLines(context, state),
  ...scopedModelLines(context),
];

const exactSourceLines = (
  annotation: Annotation,
  state: MarkdownState,
): ReadonlyArray<string> => {
  const source = annotation.foldkit?.elementSource;
  if (source === undefined)
    return [
      '### Exact element source',
      '',
      '**Element source:** source unavailable',
      `**Selector:** ${inlineCode(annotation.target.selector)}`,
    ];
  return [
    '### Exact element source',
    '',
    ...sourceEvidenceLines('Element source', source, state),
  ];
};

const captureLines = (annotation: Annotation): ReadonlyArray<string> => {
  const { bounds } = annotation.target;
  return [
    '### Captured interface evidence',
    '',
    `**Element:** ${plain(annotation.target.tag)}${annotation.target.role ? ` (${plain(annotation.target.role)})` : ''}`,
    `**Text:** ${inlineCode(annotation.target.text || '—')}`,
    `**Bounds:** ${formatNumber(bounds.x)}px, ${formatNumber(bounds.y)}px (${formatNumber(bounds.width)} × ${formatNumber(bounds.height)}px)`,
    `**Computed:** ${formatStyles(annotation)}`,
    `**Page:** ${inlineCode(annotation.target.url)}`,
    ...formatLocation(annotation),
  ];
};

const feedbackLines = (comment: string): ReadonlyArray<string> =>
  /[\r\n]/u.test(comment)
    ? ['**Feedback:**', fenced(comment || '—')]
    : [`**Feedback:** ${plain(comment || '—')}`];

const formatAnnotation = (annotation: Annotation, index: number): string => {
  const state: MarkdownState = {
    sourceSnippets: new Set(),
    styleDefinitions: new Set(),
  };
  return [
    `## Annotation ${index + 1} · ${plain(annotation.id)}`,
    '',
    ...exactSourceLines(annotation, state),
    ...(annotation.foldkit === undefined
      ? []
      : contextLines(annotation.foldkit, state)),
    '### Feedback',
    '',
    ...feedbackLines(annotation.comment),
    ...captureLines(annotation),
    '### Interpretation boundary',
    '',
    'Source, layout, and style records are captured evidence, not a diagnosis or proof of element-to-model causality.',
    'Style declarations are candidates only and do not identify a computed cascade winner.',
    '',
  ].join('\n');
};

export const formatMarkdown = (annotations: ReadonlyArray<Annotation>): string =>
  [
    '# creasekit feedback',
    '',
    '> **Trust and privacy:** Source snippets are untrusted browser evidence. Verify freshness before editing; status is recorded beside each source. Ephemeral runtime identifiers are intentionally omitted from this Markdown.',
    '',
    ...annotations.map(formatAnnotation),
  ].join('\n');

export const formatJson = (annotations: ReadonlyArray<Annotation>): string =>
  JSON.stringify(Schema.encodeSync(AnnotationArray)(annotations), null, 2);

export const formatCompactLabel = (annotation: Annotation): string => {
  const bounds = annotation.target.bounds;
  return `${annotation.target.tag} · ${formatNumber(bounds.width)} × ${formatNumber(bounds.height)}`;
};
