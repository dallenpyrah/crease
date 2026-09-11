<img src="https://raw.githubusercontent.com/dallenpyrah/creasekit/main/src/assets/creasekit.svg" width="48" height="48" alt="creasekit" />

# creasekit

Visual feedback and read-only MCP context for FoldKit applications. Add the Vite plugin to automatically inspect source and scoped Model context, leave notes, and share an intentional snapshot with a coding agent.

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

### Start the development overlay

Start the application's normal development command:

```bash
npm run dev
```

The plugin mounts the overlay automatically in development. No entry-module mount, CSS import, scope registrations, or application-written view/update wrappers are required. Open the application's own Vite URL, then click the creasekit icon or press `Alt+Shift+C` to open the toolbar. It starts collapsed so normal page interaction still works. The address `http://127.0.0.1:4173` is only this repository's demo address.

Drag the toolbar by its grip to reposition it, or focus the grip and use the arrow keys (`Shift` moves farther). Its position stays in place for the current mount and is kept inside the viewport when resized or expanded. Click **Hide creasekit** or press `Alt+Shift+H` to hide the entire overlay, including its launcher. Press `Alt+Shift+H` again, or `Alt+Shift+C`, to bring it back. Shortcuts are ignored while typing in a form field.

Normal consumer production builds exclude the overlay, source instrumentation, and MCP bridge. Applications that intentionally own their overlay mount can keep the [optional manual integration](https://github.com/dallenpyrah/creasekit/blob/main/docs/AUTOMATIC_CONTEXT.md#existing-manual-integrations).

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

## Inspect FoldKit context

Supported FoldKit views automatically expose their owning view, original element-builder location, submodel instance, Model supply site, and declared event Messages. Enable **Include scoped Model & history** to capture a bounded, sanitized snapshot of the rendered scope. Notes freeze the context captured when you create them; later application updates do not rewrite that evidence.

See [Automatic FoldKit context](https://github.com/dallenpyrah/creasekit/blob/main/docs/AUTOMATIC_CONTEXT.md) for verified framework versions, field exclusions, and unsupported patterns. Source ownership comes from development instrumentation, not a DOM-selector guess. Native DevTools history is unavailable in the automatic integration; the [optional explicit adapter](https://github.com/dallenpyrah/creasekit/blob/main/docs/FOLDKIT.md) supports curated projections and bounded observed updates.

## What an agent can read

Notes remain in the browser until you copy or explicitly share them. MCP exposes only a captured, read-only snapshot that you chose to share; it expires after 15 minutes and disappears when the Vite dev server stops. Stopping sharing cannot erase information an agent has already read.

Model values are opt-in, scoped to the rendered view, and excluded from saved annotation storage. Sensitive-looking keys are redacted; configure `excludeModelKeys` for application-specific exclusions. Explicit adapters can include their bounded update history after consent. Review all captured text before sharing it, especially on pages with private information. [Usage and privacy details](https://github.com/dallenpyrah/creasekit/blob/main/docs/USAGE.md) and the [MCP sharing limits](https://github.com/dallenpyrah/creasekit/blob/main/docs/MCP.md#sharing-and-privacy) explain the boundary.

## Documentation

- [Use the overlay](https://github.com/dallenpyrah/creasekit/blob/main/docs/USAGE.md)
- [Connect an MCP client](https://github.com/dallenpyrah/creasekit/blob/main/docs/MCP.md)
- [Automatic FoldKit context](https://github.com/dallenpyrah/creasekit/blob/main/docs/AUTOMATIC_CONTEXT.md)
- [Register FoldKit context](https://github.com/dallenpyrah/creasekit/blob/main/docs/FOLDKIT.md)
- [Contribute to creasekit](https://github.com/dallenpyrah/creasekit/blob/main/docs/CONTRIBUTING.md)
- [Design guide](https://github.com/dallenpyrah/creasekit/blob/main/docs/DESIGN.md)
