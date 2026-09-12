import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentSnapshot } from './agent-contract';
import type { Annotation } from './domain';
import type { FoldkitContext } from './foldkit-schema';
import {
  SOURCE_CONTEXT_BATCH_SIZE,
  SOURCE_EVIDENCE_BRIDGE_MAX_BYTES,
  SOURCE_EVIDENCE_SNAPSHOT_MAX_BYTES,
  enrichAnnotations,
  enrichSnapshot,
} from './source-evidence';
import type { SourceEvidence, SourceSpan } from './source-schema';

const revision = (character: string): string => character.repeat(64);

const source = (
  line: number,
  overrides: Partial<SourceEvidence> = {},
): SourceEvidence => ({
  file: 'src/page.ts',
  view: 'page',
  line,
  column: 3,
  endLine: line,
  endColumn: 24,
  revision: revision('a'),
  ...overrides,
});

const annotation = (id: string, foldkit: FoldkitContext): Annotation => ({
  version: 1,
  id,
  comment: `Feedback for ${id}`,
  status: 'open',
  target: {
    tag: 'button',
    selector: `#${id}`,
    role: 'button',
    text: 'Deploy',
    classes: '',
    url: 'http://localhost:5173/',
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    styles: {
      display: 'block',
      position: 'static',
      fontFamily: 'Inter',
      fontSize: '14px',
      lineHeight: '20px',
      color: 'rgb(0, 0, 0)',
      backgroundColor: 'rgb(255, 255, 255)',
      margin: '0px',
      padding: '8px',
      gap: '4px',
    },
  },
  capture: {
    viewportWidth: 1280,
    viewportHeight: 720,
    scrollX: 0,
    scrollY: 0,
    capturedAt: 1,
  },
  createdAt: 1,
  updatedAt: 1,
  foldkit,
});

const automatic = (owner: SourceEvidence): FoldkitContext => ({
  provenance: 'automatic-instrumentation',
  boundary: 'page',
  source: owner,
  events: [],
  capturedAt: 1,
});

const response = (sources: ReadonlyArray<SourceSpan>): Response =>
  new Response(
    JSON.stringify({
      sources: sources.map((item) => ({
        ...item,
        snippet: `source at ${item.line}`,
        snippetTruncated: false,
        status: 'current',
      })),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

const requestedSources = (init: RequestInit | undefined): SourceSpan[] =>
  JSON.parse(String(init?.body)).sources;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('source evidence hydration', () => {
  it('deduplicates automatic owner, element, model, call, and layout sources', async () => {
    const owner = source(1);
    const element = source(2);
    const definition = source(3, { view: 'PageModel' });
    const invocation = source(4, { view: 'child' });
    const layout = source(5, { view: 'layout' });
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      response(requestedSources(init)),
    );
    const automaticAnnotation = annotation('automatic', {
      ...automatic(owner),
      elementSource: element,
      modelSource: {
        expression: 'model.page',
        file: 'src/page.ts',
        line: 8,
        column: 4,
        definition,
      },
      calls: [
        { kind: 'submodel', source: invocation },
        { kind: 'helper', source: invocation },
      ],
      layout: [
        {
          tag: 'main',
          source: layout,
          bounds: { x: 0, y: 0, width: 500, height: 300 },
          display: 'block',
          position: 'static',
          padding: '0px',
          border: '0px',
          gap: '0px',
          overflow: 'visible',
          scrollTop: 0,
          scrollLeft: 0,
        },
      ],
      instanceKey: 'private-runtime-key',
    });
    const explicitAnnotation = annotation('explicit', {
      provenance: 'explicit-registration',
      boundary: 'registered',
      source: source(9, { snippet: 'registered source', status: 'current' }),
      events: [],
      capturedAt: 1,
    });

    const result = await enrichAnnotations([automaticAnnotation, explicitAnnotation], {
      fetch,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const request = requestedSources(fetch.mock.calls[0]?.[1]);
    expect(request.map((item) => item.line)).toEqual([1, 2, 3, 4, 5]);
    expect(JSON.stringify(request)).not.toContain('instanceKey');
    expect(request[0]).not.toHaveProperty('snippet');
    expect(result[0]?.foldkit?.source).toMatchObject({
      status: 'current',
      snippet: 'source at 1',
    });
    expect(result[0]?.foldkit?.elementSource).toMatchObject({
      status: 'current',
      snippet: 'source at 2',
    });
    expect(result[0]?.foldkit?.modelSource?.definition).toMatchObject({
      status: 'current',
      snippet: 'source at 3',
    });
    expect(result[0]?.foldkit?.calls?.[0]?.source).toMatchObject({
      status: 'current',
      snippet: 'source at 4',
    });
    expect(result[0]?.foldkit?.layout?.[0]?.source).toMatchObject({
      status: 'current',
      snippet: 'source at 5',
    });
    expect(result[1]).toBe(explicitAnnotation);
  });

  it('marks source evidence unavailable after a client error without discarding captures', async () => {
    const definition = source(20, {
      file: 'src/styles.ts',
      revision: revision('b'),
      snippet: 'color: red;',
      status: 'current',
    });
    const captured = source(10, {
      snippet: "h.button([], ['Deploy'])",
      status: 'current',
      styles: [
        {
          expression: 'styles.button',
          use: source(10),
          definition,
        },
      ],
    });
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const [result] = await enrichAnnotations(
      [annotation('offline', automatic(captured))],
      {
        fetch,
      },
    );

    expect(result?.foldkit?.source).toMatchObject({
      status: 'unavailable',
      snippet: "h.button([], ['Deploy'])",
    });
    expect(result?.foldkit?.source.styles?.[0]?.definition).toMatchObject({
      status: 'unavailable',
      snippet: 'color: red;',
    });
  });

  it('rejects a mismatched response reference instead of accepting its literal', async () => {
    const captured = source(10, { snippet: 'captured source', status: 'current' });
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sources: [
              {
                ...captured,
                file: 'src/unrelated.ts',
                snippet: 'untrusted source',
                snippetTruncated: false,
                status: 'current',
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const [result] = await enrichAnnotations(
      [annotation('mismatch', automatic(captured))],
      {
        fetch,
      },
    );

    expect(result?.foldkit?.source).toMatchObject({
      status: 'unavailable',
      snippet: 'captured source',
    });
    expect(result?.foldkit?.source.snippet).not.toBe('untrusted source');
  });

  it('bounds a hung request and downgrades its source', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise<Response>(() => undefined));
    const pending = enrichAnnotations([annotation('timeout', automatic(source(10)))], {
      fetch,
      timeoutMs: 1,
    });

    await vi.advanceTimersByTimeAsync(2);
    const [result] = await pending;

    expect(result?.foldkit?.source.status).toBe('unavailable');
  });

  it('splits hydration requests into batches of at most 64 sources', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      response(requestedSources(init)),
    );
    const annotations = Array.from(
      { length: SOURCE_CONTEXT_BATCH_SIZE + 1 },
      (_, index) => annotation(`batch-${index}`, automatic(source(index + 1))),
    );

    const result = await enrichAnnotations(annotations, { fetch });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => requestedSources(call[1]).length)).toEqual([
      SOURCE_CONTEXT_BATCH_SIZE,
      1,
    ]);
    expect(result.every((item) => item.foldkit?.source.status === 'current')).toBe(
      true,
    );
  });

  it('keeps an older annotation style definition stale beside a fresh selection', async () => {
    const element = source(10, {
      snippet: "h.button([], ['Deploy'])",
      status: 'current',
      styles: [
        {
          expression: 'styles.button',
          use: source(10),
          definition: source(20, {
            file: 'src/styles.ts',
            revision: revision('b'),
            snippet: 'color: red;',
            status: 'current',
          }),
        },
      ],
    });
    const freshElement = source(10);
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const [requested] = requestedSources(init);
      if (requested === undefined) throw new Error('Missing source');
      return new Response(
        JSON.stringify({
          sources: [
            {
              ...requested,
              snippet: "h.button([], ['Deploy'])",
              snippetTruncated: false,
              status: 'current',
              styles: [
                {
                  expression: 'styles.button',
                  use: requested,
                  definition: {
                    ...source(20, {
                      file: 'src/styles.ts',
                      revision: revision('c'),
                    }),
                    snippet: 'color: blue;',
                    snippetTruncated: false,
                    status: 'current',
                  },
                },
              ],
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    const snapshot: AgentSnapshot = {
      version: 1,
      runtimeId: 'runtime',
      projectId: 'project',
      page: 'http://localhost:5173/',
      sharedAt: 1,
      annotations: [
        annotation('old', {
          ...automatic(element),
          elementSource: element,
        }),
      ],
      selection: {
        target: annotation('selection', automatic(freshElement)).target,
        foldkit: {
          ...automatic(freshElement),
          elementSource: freshElement,
        },
      },
    };

    const result = await enrichSnapshot(snapshot, { fetch });

    expect(fetch).toHaveBeenCalledOnce();
    expect(
      result.annotations[0]?.foldkit?.elementSource?.styles?.[0]?.definition,
    ).toMatchObject({
      revision: revision('b'),
      snippet: 'color: red;',
      status: 'stale',
    });
    expect(
      result.selection?.foldkit?.elementSource?.styles?.[0]?.definition,
    ).toMatchObject({
      revision: revision('c'),
      snippet: 'color: blue;',
      status: 'current',
    });
  });

  it('limits new source literals before an enriched snapshot exceeds the bridge budget', async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            sources: requestedSources(init).map((item) => ({
              ...item,
              snippet: 'x'.repeat(4_000),
              snippetTruncated: false,
              status: 'current',
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const annotations = Array.from({ length: 36 }, (_, index) => {
      const element = source(index + 1);
      return annotation(`rich-${index}`, {
        ...automatic(element),
        elementSource: element,
        ...(index === 0 ? { model: { keep: 'consented model' } } : {}),
      });
    });
    const snapshot: AgentSnapshot = {
      version: 1,
      runtimeId: 'runtime',
      projectId: 'project',
      page: 'http://localhost:5173/',
      sharedAt: 1,
      selection: null,
      annotations,
    };

    const result = await enrichSnapshot(snapshot, { fetch });

    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      SOURCE_EVIDENCE_SNAPSHOT_MAX_BYTES,
    );
    expect(result.annotations).toHaveLength(annotations.length);
    expect(result.annotations[0]?.foldkit?.model).toEqual({
      keep: 'consented model',
    });
    expect(
      result.annotations[0]?.foldkit?.availability?.some((reason) =>
        reason.includes('limited'),
      ),
    ).toBe(true);
    expect(result.annotations[0]?.foldkit?.elementSource).toMatchObject({
      file: 'src/page.ts',
      revision: revision('a'),
    });
  });

  it('limits already-saved source excerpts in a transport snapshot without changing them in memory', async () => {
    const literal = 'x'.repeat(4_000);
    const definitionLiteral = 'y'.repeat(2_000);
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            sources: requestedSources(init).map((item) => ({
              ...item,
              snippet: literal,
              snippetTruncated: false,
              status: 'current',
              styles: [
                {
                  expression: 'styles.button',
                  use: item,
                  definition: {
                    ...source(200, {
                      file: 'src/styles.ts',
                      revision: revision('b'),
                    }),
                    snippet: definitionLiteral,
                    snippetTruncated: false,
                    status: 'current',
                  },
                },
              ],
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const annotations = Array.from({ length: 36 }, (_, index) => {
      const element = source(index + 1, {
        snippet: literal,
        snippetTruncated: false,
        status: 'current',
        styles: [
          {
            expression: 'styles.button',
            use: source(index + 1),
            definition: source(200, {
              file: 'src/styles.ts',
              revision: revision('b'),
              snippet: definitionLiteral,
              snippetTruncated: false,
              status: 'current',
            }),
          },
        ],
      });
      return annotation(`saved-${index}`, {
        ...automatic(element),
        elementSource: element,
        ...(index === 0 ? { model: { keep: 'consented model' } } : {}),
      });
    });
    const snapshot: AgentSnapshot = {
      version: 1,
      runtimeId: 'runtime',
      projectId: 'project',
      page: 'http://localhost:5173/',
      sharedAt: 1,
      selection: null,
      annotations,
    };

    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeGreaterThan(
      SOURCE_EVIDENCE_BRIDGE_MAX_BYTES,
    );
    const result = await enrichSnapshot(snapshot, { fetch });

    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      SOURCE_EVIDENCE_SNAPSHOT_MAX_BYTES,
    );
    expect(result.annotations).toHaveLength(annotations.length);
    expect(result.annotations[0]?.foldkit?.model).toEqual({
      keep: 'consented model',
    });
    expect(
      result.annotations[0]?.foldkit?.availability?.some((reason) =>
        reason.includes('limited'),
      ),
    ).toBe(true);
    expect(result.annotations[0]?.foldkit?.elementSource).toMatchObject({
      file: 'src/page.ts',
      revision: revision('a'),
      snippetTruncated: true,
    });
    expect(snapshot.annotations[0]?.foldkit?.elementSource?.snippet).toHaveLength(
      literal.length,
    );
    expect(snapshot.annotations[0]?.foldkit?.elementSource?.styles).toHaveLength(1);
  });

  it('leaves a baseline snapshot above the bridge cap untouched', async () => {
    const fetch = vi.fn();
    const snapshot: AgentSnapshot = {
      version: 1,
      runtimeId: 'runtime',
      projectId: 'project',
      page: 'http://localhost:5173/',
      sharedAt: 1,
      selection: null,
      annotations: [annotation('too-large', automatic(source(1)))],
    };
    const oversized = {
      ...snapshot,
      annotations: [
        {
          ...snapshot.annotations[0]!,
          comment: 'x'.repeat(SOURCE_EVIDENCE_BRIDGE_MAX_BYTES + 1),
        },
      ],
    };

    const result = await enrichSnapshot(oversized, { fetch });

    expect(result).toBe(oversized);
    expect(result.annotations[0]?.comment).toHaveLength(
      SOURCE_EVIDENCE_BRIDGE_MAX_BYTES + 1,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
