import { Effect } from 'effect';
import * as Story from 'foldkit/story';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopySetupSnippet, Message, type Model, init, update } from './main';

const copyStatusIs = (expected: Model['copyStatus']) =>
  Story.model<Model>((model) => {
    expect(model.copyStatus).toEqual(expected);
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('homepage setup copy commands', () => {
  it('starts without a copy result', () => {
    Story.story(
      update,
      Story.given(init().model),
      copyStatusIs(null),
      Story.Command.expectNone(),
    );
  });

  it('waits for the clipboard command before reporting success', () => {
    Story.story(
      update,
      Story.given(init().model),
      Story.message(Message.ClickedCopySetupSnippet({ snippet: 'install-npm' })),
      copyStatusIs(null),
      Story.Command.expectExact(CopySetupSnippet({ snippet: 'install-npm' })),
      Story.Command.resolve(
        CopySetupSnippet({ snippet: 'install-npm' }),
        Message.CopiedSetupSnippet({ snippet: 'install-npm' }),
      ),
      copyStatusIs({ snippet: 'install-npm', outcome: 'copied' }),
      Story.Command.expectNone(),
    );
  });

  it('records a failure instead of claiming that code was copied', () => {
    Story.story(
      update,
      Story.given(init().model),
      Story.message(Message.ClickedCopySetupSnippet({ snippet: 'mcp-config' })),
      Story.Command.resolve(
        CopySetupSnippet({ snippet: 'mcp-config' }),
        Message.FailedToCopySetupSnippet({ snippet: 'mcp-config' }),
      ),
      copyStatusIs({ snippet: 'mcp-config', outcome: 'failed' }),
      Story.Command.expectNone(),
    );
  });

  it('copies the exact displayed Vite configuration', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(
      Effect.runPromise(CopySetupSnippet({ snippet: 'vite-config' }).effect),
    ).resolves.toEqual(Message.CopiedSetupSnippet({ snippet: 'vite-config' }));
    expect(writeText).toHaveBeenCalledWith(
      [
        "import { foldkit } from '@foldkit/vite-plugin';",
        "import { creasekit } from 'creasekit/vite';",
        "import { defineConfig } from 'vite';",
        '',
        'export default defineConfig({',
        '  plugins: [foldkit(), creasekit()],',
        "  server: { host: '127.0.0.1' },",
        '});',
      ].join('\n'),
    );
  });

  it('turns a clipboard rejection into an honest failure message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(
      Effect.runPromise(CopySetupSnippet({ snippet: 'install-bun' }).effect),
    ).resolves.toEqual(Message.FailedToCopySetupSnippet({ snippet: 'install-bun' }));
    expect(writeText).toHaveBeenCalledWith('bun add -D creasekit');
  });
});
