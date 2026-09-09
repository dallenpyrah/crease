# Connect a coding agent

Crease's MCP server lets a coding agent read the feedback and element context you choose to share. The agent receives a read-only snapshot; it cannot use Crease to run commands, edit files, or change your application.

## Before you start

You need a local Crease checkout with its dependencies installed, Node 26, and a coding agent that supports local stdio MCP servers. Follow [Try it locally](../README.md#try-it-locally) if you have not started the app yet.

Keep `npm run dev` running while your agent uses Crease. This connection works on the same computer as the development server. Remote servers, tunnels, and production previews do not support sharing.

## Configure your agent

Add this server to your client's MCP configuration:

```json
{
  "mcpServers": {
    "crease": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/crease", "run", "--silent", "mcp"]
    }
  }
}
```

Replace `/absolute/path/to/crease` with your checkout's absolute path. Run `pwd` in that directory if you need to look it up. If your client uses a settings form instead of this JSON format, enter `npm` as the command and the five array entries as separate arguments.

Keep `--silent`: it prevents npm's startup text from interfering with the MCP connection. Your client starts this process; you do not need to launch a second MCP process in a terminal. No API key is required.

## Share your first snapshot

1. Open `http://127.0.0.1:4173`, select an element, and add any notes you want the agent to read.
2. Open **Feedback** and review the Markdown or JSON preview of your notes. If you want to share registered application state, enable **Include scoped Model & history** and review the fields before capturing them in a note.
3. Choose **Share snapshot**. Wait for the status to confirm that a captured snapshot is shared.
4. Ask your agent: “List the shared Crease sessions, read the context for this page, and summarize the requested changes before editing.”

The agent should find the page through `crease_list_sessions`, then read it using the returned `runtimeId`. A snapshot contains the selected element, if any, and your notes. It includes registered source and Message metadata where available, plus scoped Model fields and history only when you have opted in.

The Feedback preview shows note exports, not a complete preview of the MCP snapshot's separate selection field. Review the selected element in the inspector too.

## Refresh or stop sharing

Snapshots do not update automatically. After changing the page or your feedback, choose **Share snapshot** again to capture the new state.

Choose **Stop sharing** to prevent further reads of that snapshot. Snapshots also expire after 15 minutes and disappear when the development server restarts. Share again when you want to resume.

Revocation does not erase information an agent has already read or copied. Treat sharing as handing over a copy, not granting temporary access to data that can later be recalled.

## Available tools

| Tool                    | Inputs                      | Result                                                                          |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `crease_list_sessions`  | None                        | Shared pages with their runtime IDs, project IDs, and share times.              |
| `crease_get_context`    | `runtimeId`                 | The captured selection, notes, and available registered context for that page.  |
| `crease_get_annotation` | `runtimeId`, `annotationId` | One note and its captured context. Get the annotation ID from the page context. |

All three tools are read-only. Source paths tell the agent where to look in a project it can already access; they do not grant filesystem access. An agent needs its own separately authorized tools to make changes.

## Sharing and privacy

- Nothing is available through MCP until you choose **Share snapshot**. Shared snapshots stay in the local development server's memory, not a Crease cloud service.
- Model/history sharing starts off and includes only developer-registered fields. Crease excludes these values from saved annotation storage. Turning off Model consent also attempts to revoke shared context, including a pending share.
- Crease excludes form values and URL query strings and fragments from new element captures and redacts text marked `data-crease-private`. Review the output anyway; these safeguards cannot identify every sensitive value, including text you enter in a note.
- The server creates `.crease/mcp-session.json` so the MCP process can authenticate locally. **Do not copy, publish, or commit this file.** Keep the existing Git ignore rule. Do not put its contents in your MCP configuration.
- A share can contain up to 100 annotations and must fit within 128 KiB. The server accepts up to 20 shared sessions at once. It rejects oversized snapshots instead of silently dropping notes.

If Crease cannot confirm a share or revocation, it reports that uncertainty. Retry the request rather than assuming access has changed. Restarting the development server clears its shared snapshots.

## Troubleshooting

| Symptom or error                            | What to do                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent does not list Crease's tools.     | Check the client's MCP settings. Confirm it can find `npm`, the checkout path is absolute, and you ran `npm ci`. Keep `--silent` in the arguments.                           |
| `bridge_offline`                            | Start `npm run dev` in the checkout named in the MCP configuration. Keep it running and use the local browser address above.                                                 |
| The session list is empty.                  | Choose **Share snapshot** in the development app. If you already shared, the snapshot may have expired, been revoked, or disappeared on restart.                             |
| `not_shared`                                | List sessions again and use the current runtime ID. For a missing annotation, read the page context to find its current annotation IDs. Share again if necessary.            |
| `snapshot_stale`                            | The snapshot expired. Return to the browser and choose **Share snapshot** again.                                                                                             |
| `stale_session` or `authentication_failed`  | Restart the development server in the configured checkout and share again. Do not repair the session file by copying a credential from another checkout.                     |
| `invalid_bridge_response`                   | Restart the local development server and reconnect the client. If it continues, capture the error code and report it without including the session file or private feedback. |
| The browser cannot confirm sharing.         | Check that the development server is running and the snapshot is within the limits above. Retry, or choose **Stop sharing** if you do not want it exposed.                   |
| The Feedback panel has no sharing controls. | Use `npm run dev`, not a production preview. A custom integration also needs an agent connection; see the [contributor guide](CONTRIBUTING.md).                              |
