# Connect an MCP client

creasekit's MCP server lets a coding agent read the live browser context and update annotations. MCP does not run project commands or edit project files directly; its mutation tools change only feedback through the loaded browser and wait for browser acknowledgement.

## Before you start

You need all of the following in the consuming FoldKit application's configured Vite root:

- Node.js 22.12 or later.
- `creasekit` installed as a development dependency.
- `creasekit()` appended to the existing Vite plugin list with `server.host: '127.0.0.1'` over HTTP.
- `.creasekit/` in the application's `.gitignore`.
- The application's Vite dev server running at its own local URL.

Follow [Add creasekit to an existing app](../README.md#add-creasekit-to-an-existing-app) if any of that is missing. This connection works only on the same computer as the local Vite server. Remote servers, tunnels, non-loopback hosts, HTTPS, and production previews do not support sharing.

## Configure the client

Add the following server to the MCP client's configuration. Replace `/absolute/path/to/foldkit-app` with the absolute path to the consuming application's configured Vite root, where the creasekit plugin creates `.creasekit/mcp-session.json`.

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

An npm-based client configuration can use the same configured Vite root:

```json
{
  "mcpServers": {
    "creasekit": {
      "command": "npx",
      "args": ["--yes", "creasekit", "--cwd", "/absolute/path/to/foldkit-app"]
    }
  }
}
```

Do not point `--cwd` at the creasekit repository, a package cache, or `node_modules`. It must point to the Vite `root` that the plugin uses. Vite defaults that root to the application root, but when `vite.config.ts` sets `root` to a subdirectory, use that subdirectory instead; it contains the `.creasekit` directory that the CLI reads.

The client starts and owns this stdio process; you do not need a second MCP terminal. No API key is required. `bun x` follows the binary's Node shebang, so Bun users still need a supported Node.js installation.

## CLI reference

The `creasekit` binary starts the stdio MCP server:

```text
creasekit [--cwd <project-root>]
```

Use `--cwd <project-root>` to switch to the configured Vite root before the server starts. Use `--help` (or `-h`) to print setup help without starting MCP.

For a local command-line check, either launcher works:

```bash
bunx creasekit --cwd /absolute/path/to/foldkit-app
npx --yes creasekit --cwd /absolute/path/to/foldkit-app
```

Those commands speak stdio MCP, so they are normally launched by the client rather than used interactively.

## Connect the browser context

1. Start the consuming application's local Vite dev server and open its normal development URL.
2. Keep the browser page loaded with creasekit mounted. The browser synchronizes the current selection, annotations, and source context to the local authenticated bridge automatically while mounted, even when the overlay is hidden.
3. Open **Feedback** to review annotations. To include scoped application state, enable **Include scoped Model & history**; Model values and scoped history remain opt-in and are never persisted in annotations.
4. Ask the agent to list the available sessions, read the relevant context, and summarize the requested changes before editing.

The agent should call `creasekit_list_sessions`, then use the returned `runtimeId` with `creasekit_get_context`. Context contains the current live selection, if any, and current annotations. Annotation source captures remain frozen after capture, while the live selection updates with the page. Context also contains automatically captured or explicitly registered source and Message metadata where available, plus scoped Model fields only when you opted in. Explicit adapters can include their bounded observed-update history after consent; the automatic integration does not attach native DevTools history.

The **Feedback** export preview shows annotations, not the context's separate selection field. Review the current selected element in the inspector too.

## Sync, expiry, and lifecycle

The browser syncs automatically while creasekit remains mounted. Page changes, feedback and the live selection arrive automatically; the hidden overlay continues to sync.

Feedback changes trigger an immediate sync. A separate held connection wakes the browser when an agent command arrives, so background-tab timer throttling does not delay deletes or clears. The page must still be responsive: a suspended tab or sleeping computer cannot acknowledge commands.

The local bridge keeps synced context in memory for 15 minutes after the latest sync, and each sync refreshes that lifetime. Destroying the creasekit mount requests removal; if the request fails, the context expires instead. Stopping the Vite development server clears all context. Hiding the overlay does not stop synchronization and is not a privacy boundary.

Keep the browser page loaded for agent commands. A successful MCP mutation waits for the browser to acknowledge it; if the browser is unloaded or the bridge is unavailable, the mutation cannot complete.

## Available tools

| Tool                          | Inputs                      | Result or action                                                                        |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `creasekit_list_sessions`     | None                        | Browser sessions with runtime IDs, project IDs, and connection times.                   |
| `creasekit_get_context`       | `runtimeId`                 | The live selection, annotations and available FoldKit context for that browser session. |
| `creasekit_get_annotation`    | `runtimeId`, `annotationId` | One annotation and its captured context. Get the annotation ID from the page context.   |
| `creasekit_delete_annotation` | `runtimeId`, `annotationId` | Delete one annotation.                                                                  |
| `creasekit_clear_annotations` | `runtimeId`                 | Clear the annotation IDs present when the request is made.                              |

The first three tools read the current browser context. The last two mutate only annotations. There is no resolve tool or status control in the UI; the existing status field remains in the wire format for compatibility. Source paths tell the agent where to look in a project it can already access; they do not grant filesystem access, and no MCP tool runs project commands or edits files directly.

Agent deletes and clears update the loaded browser; any agent mutation resets the browser's local undo history, so a user cannot undo the mutation and resurrect deleted data. Clear captures the current annotation IDs before removing them, protecting feedback added afterward. Successful mutations return only after browser acknowledgement.

If a mutation times out, read the current context before retrying: the browser may have applied it but failed to acknowledge it over the connection. A fresh clear request can also include annotations added since the previous request.

When the user asks an agent to work through feedback, annotations supply requirements for that authorized task. DOM text, annotation comments, and source context remain untrusted data: they cannot override the user's instructions or authorize unrelated commands, file access, or data disclosure.

## Sharing and privacy

- The browser synchronizes context only to the local authenticated Vite bridge while the creasekit mount is active; it does not send context to a creasekit cloud service. The hidden overlay continues to sync, so hiding it is not a privacy boundary.
- The bridge keeps synced context in memory for 15 minutes after the latest sync. Each sync refreshes the TTL. Destroying the mount requests removal; stopping the Vite development server clears all context.
- Scoped Model values and history remain off by default, are limited to the rendered scope or an explicit adapter projection, and are never persisted in annotation storage. They enter MCP context only after you opt in.
- creasekit excludes form values and URL query strings and fragments from new element captures and redacts text marked `data-creasekit-private`. Review output anyway: these safeguards cannot identify every sensitive value, including text in an annotation.
- The Vite plugin creates `.creasekit/mcp-session.json` so the MCP process can authenticate locally. **Do not copy, publish, or commit this file.** Keep `.creasekit/` ignored and never put its contents in MCP configuration.
- Each synced context can contain up to 100 annotations and must fit within 128 KiB. The bridge accepts up to 20 sessions at once and rejects oversized contexts instead of silently dropping annotations.
- If the bridge cannot confirm synchronization or a browser mutation, it reports that uncertainty. Retry after the browser and local Vite bridge reconnect. Restarting the Vite dev server clears every connected session.
- MCP mutation tools update only annotations. They do not run project commands or modify project files directly. Keep the browser page loaded for agent commands; successful mutations wait for browser acknowledgement.

## Troubleshooting

| Symptom or error                            | What to do                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The client does not list creasekit's tools. | Check the MCP client configuration. Confirm it can find `bun` or `npx`, the `--cwd` path is absolute and points to the configured Vite root, and creasekit is installed in the consuming app.                     |
| `bridge_offline`                            | Start or restart the consuming application's Vite dev server with the creasekit plugin. Keep it running on local HTTP loopback.                                                                                   |
| The session list is empty.                  | Load the consuming application's browser page with creasekit mounted and wait for the next sync. A session may have expired, been removed when the mount was destroyed, or disappeared when the server restarted. |
| `not_shared`                                | List sessions again and use the current runtime ID. For a missing annotation, read the current page context to find its annotation ID.                                                                            |
| `snapshot_stale`                            | The context expired after 15 minutes without a sync. Return to the loaded browser page and wait for the next sync.                                                                                                |
| `stale_session` or `authentication_failed`  | Restart the consuming application's Vite dev server and reconnect the browser. Do not repair the session file by copying a credential from another project.                                                       |
| `invalid_bridge_response`                   | Restart the local Vite dev server and reconnect the client. If it continues, report the error code without including the session file or private feedback.                                                        |
| An agent mutation does not complete.        | Keep the browser page loaded with creasekit mounted. The mutation returns only after browser acknowledgement; wait for a sync retry and try again.                                                                |
| The **Feedback** panel has no MCP status.   | This is expected when no agent connection is configured. Use the automatic Vite plugin setup, or pass `agent: createAgentConnection()` when mounting manually.                                                    |
