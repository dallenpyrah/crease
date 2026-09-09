<img src="https://raw.githubusercontent.com/dallenpyrah/creasekit/main/src/assets/creasekit.svg" width="48" height="48" alt="creasekit" />

# creasekit

Visual feedback and read-only MCP context for FoldKit applications. Mount the overlay in your existing Vite app to inspect elements, leave notes, and share an intentional snapshot with a coding agent.

> **First release pending:** `creasekit` is not yet published to npm, and its license is still being finalized. The commands below describe the consumer setup for the first release.

## Add creasekit to an existing app

Use an existing FoldKit application with Vite. creasekit requires Node.js 22.12 or later. From the **consuming application's root**—not this repository or a package directory—install it as a development dependency:

```bash
bun add -D creasekit
```

```bash
npm install -D creasekit
```

Add creasekit's local session directory to that application's `.gitignore` before starting the dev server:

```gitignore
.creasekit/
```

### Add the Vite plugin

This is the complete minimum Vite configuration used by the packaged consumer fixture:

```ts
import { foldkit } from '@foldkit/vite-plugin';
import { creasekit } from 'creasekit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [foldkit(), creasekit()],
  server: { host: '127.0.0.1' },
});
```

In an existing config, append `creasekit()` to the existing plugin list and preserve every other plugin and server option. The plugin requires an explicit `server.host: '127.0.0.1'` and Vite's local HTTP server. Do not expose the server on a network interface, use a tunnel, or enable HTTPS: MCP sharing is intentionally loopback-only.

The plugin writes its local session file under Vite's configured `root`, which defaults to the application root. If the config sets `root` to a subdirectory, that directory contains `.creasekit/mcp-session.json` and is the directory to use for `--cwd`.

### Mount the development overlay

In the application entry module, append only this block **after the existing** `Runtime.run(application)` call. Do not repeat that call. Replace `'my-app'` with a stable project ID for the application.

```ts
if (import.meta.env.DEV) {
  const { createAgentConnection, mountCreasekit } = await import('creasekit');
  const creasekit = mountCreasekit({
    projectId: 'my-app',
    agent: createAgentConnection(),
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => creasekit.destroy());
  }
}
```

The dynamic import keeps the overlay in development wiring. creasekit includes its own SVG layer and styles, so do not add a CSS import. Start your application as usual and open its own Vite URL. Click the creasekit icon or press `Alt+Shift+C` to open the toolbar; it starts collapsed so normal page interaction still works. The address `http://127.0.0.1:4173` is only this repository's demo address.

## Share context with an MCP client

Open the overlay's **Feedback** panel, review the selection and notes, then choose **Share snapshot**. Configure an MCP client to start the stdio server from the consuming application's configured Vite root:

```json
{
  "mcpServers": {
    "creasekit": {
      "command": "bun",
      "args": ["x", "creasekit", "--cwd", "/absolute/path/to/foldkit-app"]
    }
  }
}
```

The `--cwd` directory must be Vite's configured root, which contains `.creasekit/mcp-session.json`, not the creasekit repository or `node_modules`. Use either launcher when testing the binary yourself:

```bash
bunx creasekit --help
npx --yes creasekit --help
```

The binary starts a stdio MCP server and supports `--cwd <project-root>` and `--help`. Bun follows the binary's Node shebang, so Node.js 22.12 or later is still required. See the complete [MCP setup, tools, and troubleshooting guide](https://github.com/dallenpyrah/creasekit/blob/main/docs/MCP.md).

## Add optional FoldKit context

The overlay works without application registration. To show a selected element's source location, event Message metadata, a narrow Model projection, and observed updates, import `createFoldkitInspector` from `creasekit`, register the scopes you want to expose, wrap the existing `update` and `view`, and pass the inspector to `mountCreasekit`.

creasekit does not discover source ownership or arbitrary Model values from the DOM. [Register FoldKit context explicitly](https://github.com/dallenpyrah/creasekit/blob/main/docs/FOLDKIT.md) when that information is useful.

## What an agent can read

Notes remain in the browser until you copy or explicitly share them. MCP exposes only a captured, read-only snapshot that you chose to share; it expires after 15 minutes and disappears when the Vite dev server stops. Stopping sharing cannot erase information an agent has already read.

Model values and update history are opt-in and limited to developer-registered projections. Review all captured text before sharing it, especially on pages with private information. [Usage and privacy details](https://github.com/dallenpyrah/creasekit/blob/main/docs/USAGE.md) and the [MCP sharing limits](https://github.com/dallenpyrah/creasekit/blob/main/docs/MCP.md#sharing-and-privacy) explain the boundary.

## Documentation

- [Use the overlay](https://github.com/dallenpyrah/creasekit/blob/main/docs/USAGE.md)
- [Connect an MCP client](https://github.com/dallenpyrah/creasekit/blob/main/docs/MCP.md)
- [Register FoldKit context](https://github.com/dallenpyrah/creasekit/blob/main/docs/FOLDKIT.md)
- [Contribute to creasekit](https://github.com/dallenpyrah/creasekit/blob/main/docs/CONTRIBUTING.md)
- [Design guide](https://github.com/dallenpyrah/creasekit/blob/main/docs/DESIGN.md)
