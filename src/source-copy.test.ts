import { Storage } from 'happy-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { mountCreasekit } from './creasekit';
import type { FoldkitContext } from './foldkit-schema';

let handle: ReturnType<typeof mountCreasekit> | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('captures literal source with the note and checks freshness again when copying', async () => {
  vi.stubGlobal('localStorage', new Storage());
  document.body.innerHTML = '<button id="target">Deploy</button>';
  const target = document.querySelector('button')!;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(30, 40, 120, 36),
  );
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  let stale = false;
  const request = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    return new Response(
      JSON.stringify({
        sources: body.sources.map((source: object) => ({
          ...source,
          status: stale ? 'stale' : 'current',
          snippetTruncated: false,
          ...(stale ? {} : { snippet: "h.button([], ['Deploy'])" }),
        })),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', request);
  const source = {
    file: 'src/page.ts',
    view: 'page',
    line: 10,
    column: 3,
    endLine: 10,
    endColumn: 27,
    revision: 'a'.repeat(64),
  };
  const context: FoldkitContext = {
    provenance: 'automatic-instrumentation',
    boundary: 'page',
    source,
    elementSource: source,
    events: [],
    capturedAt: 1,
  };
  handle = mountCreasekit({
    projectId: 'source-copy',
    startOpen: true,
    foldkit: { inspect: () => context, subscribe: () => () => {} },
  });
  const shadow = document.querySelector('[data-creasekit-root]')!.shadowRoot!;
  const click = (action: string) =>
    shadow.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
  target.click();
  click('compose');
  const input = shadow.querySelector('textarea')!;
  input.value = 'Add space above';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  click('add');
  await vi.waitFor(() => {
    const saved = JSON.parse(
      localStorage.getItem('creasekit:source-copy:annotations') ?? '[]',
    );
    expect(saved[0]?.foldkit.elementSource.snippet).toBe("h.button([], ['Deploy'])");
  });
  const beforeCopy = request.mock.calls.length;
  stale = true;
  click('open-output');
  click('copy-output');
  await vi.waitFor(() => expect(copied).toHaveBeenCalled());
  expect(request.mock.calls.length).toBeGreaterThan(beforeCopy);
  const output = copied.mock.calls.at(-1)![0];
  expect(output).toContain('src/page.ts:10:3');
  expect(output).toContain("h.button([], ['Deploy'])");
  expect(output.toLowerCase()).toContain('stale');
  expect(output).not.toContain('**Element reference:**');
});
