import { Schema } from 'effect';

import { automaticInspector } from './automatic-context.js';
import type { FoldkitInspector } from './foldkit-context.js';
import type { SourceEvidenceOptions } from './source-evidence.js';
import { type SourceEvidence, SourceSpan } from './source-schema.js';

const manifest = new Map<string, SourceEvidence>();
const revisions = new Map<string, string>();
const requestSchema = Schema.Struct({ sources: Schema.Array(SourceSpan) });
const keyFor = (source: typeof SourceSpan.Type): string =>
  JSON.stringify([
    source.file,
    source.view,
    source.line,
    source.column,
    source.endLine,
    source.endColumn,
    source.revision,
  ]);

export const installHomepageSources = (
  sources: ReadonlyArray<SourceEvidence>,
): void => {
  manifest.clear();
  revisions.clear();
  for (const source of sources) {
    manifest.set(keyFor(source), {
      ...source,
      verification: 'deployed-build',
      ...(source.styles === undefined
        ? {}
        : {
            styles: source.styles.map((style) => ({
              ...style,
              ...(style.definition === undefined
                ? {}
                : {
                    definition: { ...style.definition, verification: 'deployed-build' },
                  }),
            })),
          }),
    });
    if (source.revision !== undefined) revisions.set(source.file, source.revision);
  }
};

export const homepageSourceEvidence: SourceEvidenceOptions = {
  fetch: async (_input, init) => {
    try {
      if (typeof init?.body !== 'string') throw new Error('Invalid request');
      const { sources } = Schema.decodeUnknownSync(requestSchema)(
        JSON.parse(init.body),
      );
      if (sources.length > 64) throw new Error('Invalid request');
      return Response.json({
        sources: sources.map(
          (source) =>
            manifest.get(keyFor(source)) ?? {
              ...source,
              verification: 'deployed-build',
              status:
                revisions.has(source.file) &&
                revisions.get(source.file) !== source.revision
                  ? 'stale'
                  : 'unavailable',
              snippetTruncated: false,
            },
        ),
      });
    } catch {
      return Response.json({ error: 'invalid_source_context' }, { status: 422 });
    }
  },
};

export const homepageInspector: FoldkitInspector = {
  inspect: (element) => {
    const context = automaticInspector.inspect(element, false);
    if (context === undefined) return undefined;
    const { modelSource: _modelSource, ...publicContext } = context;
    return {
      ...publicContext,
      source: { ...context.source, verification: 'deployed-build' },
      ...(context.elementSource === undefined
        ? {}
        : {
            elementSource: { ...context.elementSource, verification: 'deployed-build' },
          }),
      availability: [
        ...(context.availability ?? []),
        'Public homepage demo: source evidence describes this deployed build, not a live working tree. Model capture and MCP synchronization are disabled.',
      ],
    };
  },
  subscribe: automaticInspector.subscribe,
  ...(automaticInspector.resolve === undefined
    ? {}
    : { resolve: automaticInspector.resolve }),
};
