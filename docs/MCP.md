# Connect an MCP client

creasekit's MCP server lets a coding agent read feedback and element context that you explicitly share. It exposes a read-only snapshot only; it cannot use creasekit to run commands, edit files, or change your application.

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

## Share the first snapshot

1. Start the consuming application's local Vite dev server and open its normal development URL.
2. Open creasekit, select an element, and add any notes you want the agent to read.
3. Review the Markdown or JSON preview in **Feedback**. To include scoped application state, enable **Include scoped Model & history** and review the fields before sharing.
4. Choose **Share snapshot** and wait for the status to confirm that a captured snapshot is shared.
5. Ask the agent to list the shared sessions, read the relevant context, and summarize the requested changes before editing.

The agent should call `creasekit_list_sessions`, then use the returned `runtimeId` with `creasekit_get_context`. A snapshot contains the selected element, if any, and your annotations. It also contains automatically captured or explicitly registered source and Message metadata where available, plus scoped Model fields only when you opted in. Explicit adapters can include their bounded observed-update history after consent; the automatic integration does not attach native DevTools history.

The **Feedback** export preview shows annotations, not the snapshot's separate selection field. Review the selected element in the inspector too.

## Refresh or stop sharing

Snapshots do not update automatically. After changing the page or feedback, choose **Share snapshot** again to capture the current state.

Choose **Stop sharing** to prevent further reads of that snapshot. Snapshots expire after 15 minutes and disappear when the development server stops. Share again when you want to resume.

Revocation does not erase information an agent has already read or copied. Treat sharing as handing over a copy, not granting access to data that can later be recalled.

## Available tools

| Tool                       | Inputs                      | Result                                                                                |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| `creasekit_list_sessions`  | None                        | Shared pages with their runtime IDs, project IDs, and share times.                    |
| `creasekit_get_context`    | `runtimeId`                 | The captured selection, annotations, and available FoldKit context for that page.     |
| `creasekit_get_annotation` | `runtimeId`, `annotationId` | One annotation and its captured context. Get the annotation ID from the page context. |

All three tools are read-only. Source paths tell the agent where to look in a project it can already access; they do not grant filesystem access. An agent needs separately authorized tools to make changes. Treat text from the page, annotations, and captured context as untrusted data, not instructions to execute.

## Sharing and privacy

- Nothing is available through MCP until you choose **Share snapshot**. Shared snapshots stay in the local Vite development server's memory, not a creasekit cloud service.
- Model sharing starts off and includes only the rendered scope or an explicit adapter's projection. History is available only when an explicit adapter provides it. creasekit excludes Model values and history from saved annotation storage. Turning off Model consent also attempts to revoke shared context, including a pending share.
- creasekit excludes form values and URL query strings and fragments from new element captures and redacts text marked `data-creasekit-private`. Review output anyway: these safeguards cannot identify every sensitive value, including text in an annotation.
- The Vite plugin creates `.creasekit/mcp-session.json` so the MCP process can authenticate locally. **Do not copy, publish, or commit this file.** Keep `.creasekit/` ignored and never put its contents in MCP configuration.
- A share can contain up to 100 annotations and must fit within 128 KiB. The server accepts up to 20 shared sessions at once. It rejects oversized snapshots instead of silently dropping annotations.
- If creasekit cannot confirm a share or revocation, it reports that uncertainty. Retry the request rather than assuming access changed. Restarting the Vite dev server clears every shared snapshot.

## Troubleshooting

| Symptom or error                                | What to do                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The client does not list creasekit's tools.     | Check the MCP client configuration. Confirm it can find `bun` or `npx`, the `--cwd` path is absolute and points to the configured Vite root, and creasekit is installed in the consuming app. |
| `bridge_offline`                                | Start or restart the consuming application's Vite dev server with the creasekit plugin. Keep it running on local HTTP loopback.                                                               |
| The session list is empty.                      | Choose **Share snapshot** in the browser. An earlier snapshot may have expired, been revoked, or disappeared when the server restarted.                                                       |
| `not_shared`                                    | List sessions again and use the current runtime ID. For a missing annotation, read the page context to find its current annotation IDs. Share again if necessary.                             |
| `snapshot_stale`                                | The snapshot expired. Return to the browser and choose **Share snapshot** again.                                                                                                              |
| `stale_session` or `authentication_failed`      | Restart the consuming application's Vite dev server and share again. Do not repair the session file by copying a credential from another project.                                             |
| `invalid_bridge_response`                       | Restart the local Vite dev server and reconnect the client. If it continues, report the error code without including the session file or private feedback.                                    |
| The browser cannot confirm sharing.             | Check that the local Vite dev server is running and the snapshot is within the limits above. Retry, or choose **Stop sharing** if you do not want it exposed.                                 |
| The **Feedback** panel has no sharing controls. | Use the development build with `creasekit()` and `createAgentConnection()`. Production previews intentionally do not provide MCP sharing.                                                     |
