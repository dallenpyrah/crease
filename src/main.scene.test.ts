import * as Scene from 'foldkit/scene';
import { describe, it } from 'vitest';

import { CopySetupSnippet, Message, type Model, update, view } from './main';

const model = (): Model => ({ copyStatus: null });

const copyNpmInstall = Scene.role('button', { name: 'Copy npm install command' });
const copyMcpConfiguration = Scene.role('button', { name: 'Copy MCP configuration' });
const viteConfiguration = Scene.nth(Scene.all.selector('pre code'), 3);
const developmentMount = Scene.nth(Scene.all.selector('pre code'), 4);
const mcpConfiguration = Scene.nth(Scene.all.selector('pre code'), 6);

describe('homepage view', () => {
  it('renders the branded heading hierarchy and numbered setup guide', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expect(Scene.role('img', { name: 'creasekit' })).toHaveAttr('src'),
      Scene.expect(
        Scene.role('heading', {
          name: 'Inspect, annotate, and give feedback on any FoldKit interface',
          level: 1,
        }),
      ).toExist(),
      Scene.expect(Scene.role('heading', { name: 'Features', level: 2 })).toExist(),
      Scene.expect(Scene.role('heading', { name: 'How to use', level: 2 })).toExist(),
      Scene.expect(
        Scene.role('heading', { name: 'Install creasekit', level: 3 }),
      ).toExist(),
      Scene.expect(
        Scene.role('heading', { name: 'Configure Vite', level: 3 }),
      ).toExist(),
      Scene.expect(
        Scene.role('heading', { name: 'Mount and start in development', level: 3 }),
      ).toExist(),
      Scene.expect(
        Scene.role('heading', { name: 'Annotate and review context', level: 3 }),
      ).toExist(),
      Scene.expect(
        Scene.role('heading', { name: 'Connect an agent (optional)', level: 3 }),
      ).toExist(),
      Scene.expect(
        Scene.role('heading', { name: 'Live playground', level: 2 }),
      ).toBeAbsent(),
      Scene.expect(Scene.role('link', { name: 'Try the playground' })).toBeAbsent(),
    );
  });

  it('renders complete labelled setup code without the playground', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expectAll(Scene.all.role('listitem')).toHaveCount(21),
      Scene.expectAll(Scene.all.selector('pre code')).toHaveCount(7),
      Scene.expect(Scene.text('npm install -D creasekit')).toExist(),
      Scene.expect(Scene.text('bun add -D creasekit')).toExist(),
      Scene.expect(Scene.text('.creasekit/')).toExist(),
      Scene.expect(Scene.text('vite.config.ts')).toExist(),
      Scene.expect(Scene.text('TypeScript')).toExist(),
      Scene.expect(viteConfiguration).toHaveText(
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
      ),
      Scene.expect(developmentMount).toHaveText(
        [
          'if (import.meta.env.DEV) {',
          "  const { createAgentConnection, mountCreasekit } = await import('creasekit');",
          '  const creasekit = mountCreasekit({',
          "    projectId: 'my-app',",
          '    agent: createAgentConnection(),',
          '  });',
          '',
          '  if (import.meta.hot) {',
          '    import.meta.hot.dispose(() => creasekit.destroy());',
          '  }',
          '}',
        ].join('\n'),
      ),
      Scene.expect(
        Scene.text(
          'Automatic mounting is upcoming on main; installed 0.1.0 projects still need this block.',
        ),
      ).toBeAbsent(),
      Scene.expect(
        Scene.text(
          'Published 0.1.0 only includes source, Message, Model, and observed-update context when you explicitly register that scope. Review and consent to any Model data before sharing; automatic context is upcoming on main.',
        ),
      ).toBeAbsent(),
      Scene.expect(
        Scene.text(
          'The --cwd directory contains .creasekit/mcp-session.json. Choose Share snapshot only after reviewing the read-only snapshot, and choose Stop sharing to revoke the current one.',
        ),
      ).toExist(),
      Scene.expect(Scene.role('status')).toBeAbsent(),
    );
  });

  it('renders language-specific syntax tokens in the setup examples', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expect(
        Scene.nth(Scene.all.selector('code[data-language="typescript"] .keyword'), 0),
      ).toHaveText('import'),
      Scene.expect(
        Scene.nth(Scene.all.selector('code[data-language="typescript"] .string'), 0),
      ).toHaveText("'@foldkit/vite-plugin'"),
      Scene.expect(
        Scene.nth(Scene.all.selector('code[data-language="json"] .property'), 0),
      ).toHaveText('"mcpServers"'),
      Scene.expect(
        Scene.nth(Scene.all.selector('code[data-language="npm"] .function'), 0),
      ).toHaveText('npm'),
      Scene.expect(
        Scene.nth(Scene.all.selector('code[data-language="gitignore"] .string'), 0),
      ).toHaveText('.creasekit/'),
    );
  });

  it('shows copied only after the matching clipboard command resolves', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expect(copyNpmInstall).toBeEnabled(),
      Scene.click(copyNpmInstall),
      Scene.expectHandled(),
      Scene.expect(copyNpmInstall).toHaveText('Copy'),
      Scene.expect(Scene.role('status')).toBeAbsent(),
      Scene.Command.expectExact(CopySetupSnippet({ snippet: 'install-npm' })),
      Scene.Command.resolve(
        CopySetupSnippet({ snippet: 'install-npm' }),
        Message.CopiedSetupSnippet({ snippet: 'install-npm' }),
      ),
      Scene.expect(copyNpmInstall).toHaveText('Copied'),
      Scene.expect(Scene.role('status')).toHaveText('Copied to clipboard.'),
      Scene.Command.expectNone(),
    );
  });

  it('keeps the exact code selectable and reports copy failures honestly', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expect(copyMcpConfiguration).toBeEnabled(),
      Scene.click(copyMcpConfiguration),
      Scene.expectHandled(),
      Scene.Command.resolve(
        CopySetupSnippet({ snippet: 'mcp-config' }),
        Message.FailedToCopySetupSnippet({ snippet: 'mcp-config' }),
      ),
      Scene.expect(Scene.role('status')).toHaveText(
        'Clipboard access was denied or is unavailable. Select this code and copy it manually.',
      ),
      Scene.expect(mcpConfiguration).toHaveText(
        [
          '{',
          '  "mcpServers": {',
          '    "creasekit": {',
          '      "command": "bun",',
          '      "args": ["x", "creasekit", "--cwd", "/absolute/path/to/foldkit-app"]',
          '    }',
          '  }',
          '}',
        ].join('\n'),
      ),
      Scene.Command.expectNone(),
    );
  });
});
