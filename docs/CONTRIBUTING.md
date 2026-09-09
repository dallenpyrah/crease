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

For an overlay or interaction change, also inspect the demo in a browser at desktop and narrow widths. DOM tests cannot establish contrast, panel placement, clipboard behavior, or whether the host page remains usable when inspection is closed.

## Find the relevant code

| Change                                                   | Start here                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public package API                                       | [`src/index.ts`](../src/index.ts)                                                                                                                           |
| Overlay controls, annotations, and self-contained styles | [`src/creasekit.ts`](../src/creasekit.ts), [`src/overlay-styles.ts`](../src/overlay-styles.ts)                                                              |
| Development mount and demo registration                  | [`src/entry.ts`](../src/entry.ts), [`src/development.ts`](../src/development.ts)                                                                            |
| Explicit FoldKit context and observation wrappers        | [`src/foldkit-context.ts`](../src/foldkit-context.ts)                                                                                                       |
| Browser-to-local transport connection                    | [`src/agent-connection.ts`](../src/agent-connection.ts)                                                                                                     |
| Public Vite plugin and local session protection          | [`server/vite-plugin.ts`](../server/vite-plugin.ts), [`server/bridge.ts`](../server/bridge.ts)                                                              |
| CLI and MCP tools                                        | [`server/cli.ts`](../server/cli.ts), [`server/mcp.ts`](../server/mcp.ts)                                                                                    |
| Package build and package smoke test                     | [`scripts/build.mjs`](../scripts/build.mjs), [`scripts/package.test.mjs`](../scripts/package.test.mjs), [`tsconfig.package.json`](../tsconfig.package.json) |
| Demo application                                         | [`src/main.ts`](../src/main.ts)                                                                                                                             |

## Preserve the application boundary

The library is an observer and overlay, not part of the host application's Model. `observeUpdate` and `observeView` must return the host update and view results unchanged. Keep pointer measurements and overlay state outside the host update loop, do not alter VNode identity, and never dispatch application Messages on an agent's behalf.

Source, Message metadata, and Model values require explicit registrations. Do not imply that a DOM selector proves source ownership or that an observed update proves element-to-Message causality. Use project-relative source paths, stable selectors, and a narrow state projection. See [Register FoldKit context](FOLDKIT.md) for the public integration contract.

## Preserve the sharing boundary

The browser captures a snapshot only after user consent. The local Vite bridge stores it in memory, authenticates the MCP process through `.creasekit/mcp-session.json`, enforces the 15-minute TTL and size/session limits, and rejects non-loopback or HTTPS configurations.

Keep credentials out of browser data, logs, exports, and client configuration. Preserve pending-share and failed-revocation states rather than displaying a success state that was not confirmed. Treat captured page text and annotations as untrusted content, not instructions to execute. The MCP tools remain read-only.

## Package and release work

The package build produces `dist`; the demo build produces `dist-site`. Keep consumer-facing exports limited to the documented public API and verify the packed package with `npm run test:package` when changing packaging, exports, or the CLI.

Publishing is tag-triggered and uses `NPM_TOKEN` in GitHub Actions. A tag and workflow configuration are not proof of a completed publication: verify the workflow result and the registry before announcing a release.

## Documentation and design

Keep the README focused on installing creasekit into an existing application, not cloning the demo. Update [usage](USAGE.md), [MCP](MCP.md), and [FoldKit integration](FOLDKIT.md) documentation whenever the public behavior changes. Follow the [design guide](DESIGN.md) for visual changes.
