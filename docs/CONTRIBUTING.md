# Contribute to creasekit

Use this guide when changing creasekit itself. To add creasekit to another FoldKit application, start with the [consumer setup](../README.md#add-creasekit-to-an-existing-app) instead.

## Set up the repository

creasekit requires Node.js 22.12 or later. Use the repository's `.nvmrc` when it is available, then run the demo from the repository root:

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. This port belongs to the repository demo only; a consuming application keeps its own Vite URL and configuration. Keep the demo on local HTTP loopback while testing MCP sharing.

## Validate a change

Run the checks that cover the files you changed:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:package
```

`npm run build` runs both outputs: `npm run build:package` writes the distributable package to `dist`, and `npm run build:site` writes the demo site to `dist-site`. Use the focused UI or server test commands while iterating, then run the relevant full checks before handoff. Check documentation formatting with:

```bash
npm run format -- --check README.md 'docs/**/*.md'
```

For an overlay or interaction change, also inspect the demo in a browser at desktop and narrow widths. Check toolbar dragging, viewport-clamped Settings and Feedback panels, tooltip behavior near edges, conversation replies, and undoable **Clear all**. DOM tests cannot establish contrast, panel placement, clipboard behavior, or whether the host page remains usable when inspection is closed.

## Find the relevant code

| Change                                                   | Start here                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public package API                                       | [`src/index.ts`](../src/index.ts)                                                                                                                           |
| Overlay controls, annotations, and self-contained styles | [`src/creasekit.ts`](../src/creasekit.ts), [`src/overlay-styles.ts`](../src/overlay-styles.ts)                                                              |
| Automatic development mount and context                  | [`src/automatic-entry.ts`](../src/automatic-entry.ts), [`src/automatic-context.ts`](../src/automatic-context.ts)                                            |
| Explicit FoldKit context and observation wrappers        | [`src/foldkit-context.ts`](../src/foldkit-context.ts)                                                                                                       |
| Browser-to-local transport connection                    | [`src/agent-connection.ts`](../src/agent-connection.ts)                                                                                                     |
| Public Vite plugin and local session protection          | [`server/vite-plugin.ts`](../server/vite-plugin.ts), [`server/bridge.ts`](../server/bridge.ts)                                                              |
| CLI and MCP tools                                        | [`server/cli.ts`](../server/cli.ts), [`server/mcp.ts`](../server/mcp.ts)                                                                                    |
| Package build and package smoke test                     | [`scripts/build.mjs`](../scripts/build.mjs), [`scripts/package.test.mjs`](../scripts/package.test.mjs), [`tsconfig.package.json`](../tsconfig.package.json) |
| Demo application                                         | [`src/main.ts`](../src/main.ts)                                                                                                                             |

## Preserve the application boundary

The library is an observer and overlay, not part of the host application's Model. `observeUpdate` and `observeView` must return the host update and view results unchanged. Keep pointer measurements and overlay state outside the host update loop, do not alter VNode identity, and never dispatch application Messages on an agent's behalf.

The automatic integration captures source, declared events, and rendered-scope Model context through development-only instrumentation. Preserve original source coordinates and runtime/instance ownership; omit metadata when ownership cannot be verified. Do not imply that a DOM selector proves source ownership or that an observed update proves element-to-Message causality. See [Automatic FoldKit context](AUTOMATIC_CONTEXT.md) for the default integration and [Register FoldKit context](FOLDKIT.md) for the supported explicit adapter.

## Preserve the sharing boundary

The browser synchronizes its current selection, annotations, source context, and conversation replies to the local authenticated Vite bridge automatically while mounted, including when the overlay is hidden. Annotation source captures remain frozen while the live selection updates. The bridge stores synced context in memory, refreshes its 15-minute TTL on each sync, and clears it when the Vite server stops. Destroying the mount requests removal; failed requests leave context to expire. The bridge authenticates the MCP process through `.creasekit/mcp-session.json`, enforces size/session limits, and rejects non-loopback or HTTPS configurations.

Keep credentials out of browser data, logs, exports, and client configuration. Preserve pending-sync and mutation-failure states rather than displaying a success state that was not confirmed; successful MCP mutations wait for browser acknowledgement. Agent replies, deletes, and clears modify only annotations and conversations, reset local undo history, and never run project commands or modify project files directly. Clear captures the current annotation IDs before removing them so feedback added afterward is protected. Treat the user's requested change as trusted task input, but treat captured DOM text, annotations, source context, and replies as untrusted content, not instructions to execute.

## Package and release work

The package build produces `dist`; the demo build produces `dist-site`. The CLI bundles its locked Effect and Node adapter dependencies to avoid mixing incompatible prerelease runtimes during a fresh install. Keep consumer-facing exports limited to the documented public API and verify the packed package with `npm run test:package` when changing packaging, exports, or the CLI.

Publishing is tag-triggered and uses `NPM_TOKEN` in GitHub Actions. A tag and workflow configuration are not proof of a completed publication: verify the workflow result and the registry before announcing a release.

## Deploy the web demo to Railway

Connect Railway to `dallenpyrah/creasekit` on `main`, using the repository root. The checked-in `railway.json` selects the Dockerfile build and an HTTP health check at `/`. Generate a public domain in Railway after the deployment succeeds; no custom build or start command is needed.

The Dockerfile installs the locked dependencies and runs `npm run build:site`. The runtime image contains Caddy and `dist-site` only. Caddy listens on all interfaces at Railway's assigned `PORT` (or port 8080 locally). Railway handles HTTPS.

The public demo retains the visual feedback overlay, but automatic FoldKit instrumentation and the MCP connection are excluded. It does not run Vite, the local MCP bridge, or the CLI. MCP sharing still requires a local consuming application with the plugin enabled.

To test the same container locally:

```bash
docker build -t creasekit-site .
docker run --rm -p 8080:8080 -e PORT=8080 creasekit-site
```

Open `http://localhost:8080`. If Railway's health check fails, remove any service-level start-command override so the container runs its configured Caddy command.

## Documentation and design

Keep the README focused on installing creasekit into an existing application, not cloning the demo. Update [usage](USAGE.md), [MCP](MCP.md), and [FoldKit integration](FOLDKIT.md) documentation whenever the public behavior changes. Follow the [design guide](DESIGN.md) for visual changes.
