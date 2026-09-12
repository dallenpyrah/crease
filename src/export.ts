import { Schema } from 'effect';

import { type Annotation, AnnotationArray } from './domain.js';

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(1);

const formatStyles = (annotation: Annotation): string => {
  const { styles } = annotation.target;
  return [
    `display: ${styles.display}`,
    `font: ${styles.fontSize} ${styles.fontFamily}`,
    `color: ${styles.color}`,
    `padding: ${styles.padding}`,
    `gap: ${styles.gap}`,
  ].join('; ');
};

const formatAnnotation = (annotation: Annotation, index: number): string => {
  const { bounds } = annotation.target;
  return [
    `## Annotation ${index + 1} · ${annotation.id}`,
    '',
    `**Feedback:** ${annotation.comment}`,
    `**Element:** ${annotation.target.tag}${annotation.target.role ? ` (${annotation.target.role})` : ''}`,
    `**Selector:** \`${annotation.target.selector}\``,
    `**Text:** ${annotation.target.text || '—'}`,
    `**Bounds:** ${formatNumber(bounds.x)}px, ${formatNumber(bounds.y)}px (${formatNumber(bounds.width)} × ${formatNumber(bounds.height)}px)`,
    `**Computed:** ${formatStyles(annotation)}`,
    `**Page:** ${annotation.target.url}`,
    ...(annotation.foldkit === undefined
      ? []
      : [
          `**FoldKit scope:** ${annotation.foldkit.boundary} (${annotation.foldkit.provenance === 'automatic-instrumentation' ? 'automatic instrumentation' : 'explicit registration'})`,
          `**Source:** ${annotation.foldkit.source.file}${annotation.foldkit.source.line === undefined ? '' : `:${annotation.foldkit.source.line}`}${annotation.foldkit.source.column === undefined ? '' : `:${annotation.foldkit.source.column}`} → ${annotation.foldkit.source.view}`,
          ...(annotation.foldkit.elementSource === undefined
            ? []
            : [
                `**Element source:** ${annotation.foldkit.elementSource.file}:${annotation.foldkit.elementSource.line}:${annotation.foldkit.elementSource.column}`,
              ]),
          ...(annotation.foldkit.modelSource === undefined
            ? []
            : [
                `**Model supplied:** ${annotation.foldkit.modelSource.expression} (${annotation.foldkit.modelSource.file}:${annotation.foldkit.modelSource.line}:${annotation.foldkit.modelSource.column})`,
                ...(annotation.foldkit.modelSource.definition === undefined
                  ? []
                  : [
                      `**Model declaration:** ${annotation.foldkit.modelSource.definition.view} (${annotation.foldkit.modelSource.definition.file}:${annotation.foldkit.modelSource.definition.line}:${annotation.foldkit.modelSource.definition.column})`,
                    ]),
              ]),
          ...(annotation.foldkit.availability?.map(
            (reason) => `**Context limit:** ${reason}`,
          ) ?? []),
          `**Messages:** ${annotation.foldkit.events.map((event) => `${event.event} → ${event.message}`).join('; ') || 'No static event registered'}`,
          ...(annotation.foldkit.model === undefined
            ? []
            : [
                `**Scoped Model (opt-in capture):** ${JSON.stringify(annotation.foldkit.model)}`,
                ...(annotation.foldkit.history === undefined
                  ? []
                  : [
                      '**Observed scope updates (not inferred element-to-Command causality):**',
                    ]),
                ...(annotation.foldkit.history?.map(
                  (change) =>
                    `- ${change.message}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`,
                ) ?? []),
              ]),
        ]),
    '',
  ].join('\n');
};

export const formatMarkdown = (annotations: ReadonlyArray<Annotation>): string =>
  [
    '# creasekit feedback',
    '',
    'Context captured from the running interface. Review before editing code.',
    '',
    ...annotations.map(formatAnnotation),
  ].join('\n');

export const formatJson = (annotations: ReadonlyArray<Annotation>): string =>
  JSON.stringify(Schema.encodeSync(AnnotationArray)(annotations), null, 2);

export const formatCompactLabel = (annotation: Annotation): string => {
  const bounds = annotation.target.bounds;
  return `${annotation.target.tag} · ${formatNumber(bounds.width)} × ${formatNumber(bounds.height)}`;
};
