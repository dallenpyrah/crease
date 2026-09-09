import { Schema } from 'effect';

import { type Annotation, AnnotationArray } from './domain';

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
    `## Annotation ${index + 1} · ${annotation.id} · ${annotation.status}`,
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
          `**FoldKit scope:** ${annotation.foldkit.boundary} (explicit registration)`,
          `**Source:** ${annotation.foldkit.source.file}${annotation.foldkit.source.line === undefined ? '' : `:${annotation.foldkit.source.line}`} → ${annotation.foldkit.source.view}`,
          `**Messages:** ${annotation.foldkit.events.map((event) => `${event.event} → ${event.message}`).join('; ') || 'No static event registered'}`,
          ...(annotation.foldkit.model === undefined
            ? []
            : [
                `**Scoped Model (opt-in capture):** ${JSON.stringify(annotation.foldkit.model)}`,
                '**Observed scope updates (not inferred element-to-Command causality):**',
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
    '# Crease feedback',
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
