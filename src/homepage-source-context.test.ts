import { afterEach, expect, it, vi } from 'vitest';

import { automaticInspector } from './automatic-context';
import { makeAnnotation } from './domain';
import { formatMarkdown } from './export';
import { snapshotElement } from './geometry';
import {
  homepageInspector,
  homepageSourceEvidence,
  installHomepageSources,
} from './homepage-source-context';
import { enrichSelection } from './source-evidence';
import type { SourceEvidence } from './source-schema';

const source: SourceEvidence = {
  file: 'src/main.ts',
  view: 'view',
  line: 10,
  column: 3,
  endLine: 10,
  endColumn: 30,
  revision: 'a'.repeat(64),
  snippet: 'h.span([h.Class(styles.note)]',
  snippetTruncated: true,
  status: 'current',
};

afterEach(() => {
  installHomepageSources([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('looks up only deployed records without making a network request', async () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  installHomepageSources([source]);
  const response = await homepageSourceEvidence.fetch!('/__creasekit/source-context', {
    method: 'POST',
    body: JSON.stringify({ sources: [source] }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()).sources[0]).toMatchObject({
    snippet: source.snippet,
    status: 'current',
    verification: 'deployed-build',
  });
  expect(network).not.toHaveBeenCalled();
});

it('marks old revisions stale and unknown paths unavailable without guessing', async () => {
  installHomepageSources([source]);
  const response = await homepageSourceEvidence.fetch!('/ignored', {
    body: JSON.stringify({
      sources: [
        { ...source, revision: 'b'.repeat(64), snippet: 'untrusted supplied text' },
        { ...source, file: '../.env', snippet: 'untrusted supplied text' },
      ],
    }),
  });
  const { sources } = await response.json();
  expect(sources[0]).toMatchObject({ status: 'stale', verification: 'deployed-build' });
  expect(sources[1]).toMatchObject({ status: 'unavailable' });
  expect(JSON.stringify(sources)).not.toContain('untrusted supplied text');
});

it('caps batches and excludes Model values even if the demo checkbox is enabled', async () => {
  const response = await homepageSourceEvidence.fetch!('/ignored', {
    body: JSON.stringify({ sources: Array.from({ length: 65 }, () => source) }),
  });
  expect(response.status).toBe(422);
  const inspect = vi.spyOn(automaticInspector, 'inspect').mockReturnValue({
    provenance: 'automatic-instrumentation',
    boundary: 'view',
    source,
    modelSource: { expression: 'Model', file: 'src/main.ts', line: 1, column: 1 },
    events: [],
    capturedAt: 1,
  });
  const element = document.createElement('span');
  const context = homepageInspector.inspect(element, true);
  expect(inspect).toHaveBeenCalledWith(element, false);
  expect(context?.model).toBeUndefined();
  expect(context?.modelSource).toBeUndefined();
  expect(context?.availability?.join(' ')).toContain(
    'MCP synchronization are disabled',
  );
});

it('preserves an old captured literal when a deployed revision changes', async () => {
  installHomepageSources([
    { ...source, revision: 'c'.repeat(64), snippet: 'new build' },
  ]);
  const selected = await enrichSelection(
    {
      target: snapshotElement(document.createElement('span')),
      foldkit: {
        provenance: 'automatic-instrumentation',
        boundary: 'view',
        source,
        elementSource: source,
        events: [],
        capturedAt: 1,
      },
    },
    homepageSourceEvidence,
  );
  expect(selected?.foldkit?.elementSource).toMatchObject({
    snippet: source.snippet,
    status: 'stale',
    verification: 'deployed-build',
  });
});

it('labels copied source as deployed-build evidence rather than a live filesystem check', async () => {
  installHomepageSources([source]);
  const selected = await enrichSelection(
    {
      target: snapshotElement(document.createElement('span')),
      foldkit: {
        provenance: 'automatic-instrumentation',
        boundary: 'view',
        source,
        elementSource: source,
        events: [],
        capturedAt: 1,
      },
    },
    homepageSourceEvidence,
  );
  if (selected === null || selected.foldkit === undefined)
    throw new Error('Missing selection');
  const markdown = formatMarkdown([
    {
      ...makeAnnotation(selected.target, 'nice', 1, 'demo'),
      foldkit: selected.foldkit,
    },
  ]);
  expect(markdown).toContain(
    'verified against this deployed build, not a live working tree',
  );
  expect(markdown).toContain('src/main.ts:10:3');
  expect(markdown).toContain(source.snippet);
});
