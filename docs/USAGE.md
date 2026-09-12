# Use creasekit in your application

Use creasekit to inspect an element, describe a requested change, and keep a per-annotation conversation with your agent. First add the Vite plugin to your existing application by following the [consumer setup](../README.md#add-creasekit-to-an-existing-app). The overlay mounts automatically at the application's own Vite development URL; it does not need to use the repository demo's port.

## Switch between inspection and normal use

Open creasekit from its floating icon. When the overlay is open, it starts in **Inspect** mode, so clicking an element selects it instead of activating it. Click the creasekit icon, or press `Alt+Shift+C`, to close the overlay and use the page normally. Toggle it back on to inspect the result. Drag the toolbar by its grip, or focus the grip and use the arrow keys (`Shift` moves farther). **Settings** and **Feedback** follow the toolbar and stay within the viewport; tooltips pause during dragging and reposition near an edge.

## Inspect an element

Choose a tool, then click the element you want to inspect:

| Tool         | Shortcut | What you can read                                                              |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| Inspect      | `I`      | Dimensions, position, padding, margin, border, radius, and an element locator. |
| Typography   | `A`      | Font family, size, weight, style, line height, and letter spacing.             |
| Sample color | `P`      | Computed text and background colors. Click a swatch to copy its value.         |

Colors come from the element's computed CSS, not screenshot pixels. Dimensions and rulers use CSS pixels.

To compare spacing, select one element, then hold `Alt` while hovering another. creasekit shows the visible edge-to-edge distance. Use **Rulers** (`R`) for viewport coordinates or **X-ray** (`X`) to outline visible elements. On large pages, X-ray scans up to 2,000 elements and outlines up to 500.

Choose **Copy element** to copy the selected element's context without creating a note.

## Add and manage feedback

1. Choose **Annotate** (`N`) and click an element. If it is already selected, choose **Add a note** in the inspector.
2. Describe the intended result, such as “Add 12px below this heading,” rather than only saying “Fix spacing.”
3. Choose **Add note**, or press `Cmd/Ctrl+Enter`. A numbered pin marks the element.
4. Open **Feedback** to review the conversation for each annotation. You can edit or delete an annotation, and each thread shows replies from **You** or **Agent**. There are no Resolve or Reopen controls and no open status.

Choose **Clear all** in **Feedback** to remove the current annotations; the local clear is undoable. An agent clear targets the annotation IDs present when the request is made, so feedback added afterward is protected. Use the undo and redo buttons in **Feedback** to reverse local annotation changes. Outside text fields, `Cmd/Ctrl+Z` undoes a change and `Cmd/Ctrl+Shift+Z` redoes it. Agent mutations reset local undo history, so you cannot undo an agent deletion or clear and resurrect removed data. These controls affect annotations, not the host application.

If an element disappears, its annotation keeps its captured element and source context. The live selection updates as the page changes. You can still edit or delete the annotation. **Settings → Show annotation pins** hides pins without deleting feedback.

## Copy feedback or connect an agent

Open **Feedback** and choose **Markdown** for readable feedback or **JSON** for structured data. Review the preview, then choose **Copy for agent** and paste it into a coding agent or message to a teammate. Conversation replies are included. This workflow does not require MCP.

To let a coding agent read and update the live context directly, configure a local MCP client as described in [Connect an MCP client](MCP.md). While creasekit is mounted, the browser syncs automatically, including when the overlay is hidden. Keep the browser page loaded for agent commands; successful MCP mutations wait for browser acknowledgement. No sharing controls are required.

## Include optional FoldKit context

Instrumented elements can show their project-relative view and element source locations, submodel scope, Model supply site, and declared event Message metadata. A Message is the named event that the application handles. Enable **Include scoped Model & history** to capture a bounded, sanitized snapshot of that rendered scope. Source context and annotation captures remain frozen after capture, while the live selection updates. Scoped Model values and history are available only when you opt in and are never persisted in annotations.

Source ownership comes from development instrumentation rather than a DOM-selector guess. Unsupported elements retain ordinary inspection data; a verified ancestor's context may be shown without claiming its source as the selected element's creation site. Native DevTools history is unavailable in the automatic integration. Explicit adapters can provide observed updates, which do not prove that an element caused a particular Message or operation.

See [Automatic FoldKit context](AUTOMATIC_CONTEXT.md) for field exclusions and current limits, or [Register FoldKit context](FOLDKIT.md) for the optional explicit adapter.

## Keep feedback private

- creasekit saves annotations and conversation replies between reloads; undo history and visual settings last only for the current session. Offline local use still works, and synchronization retries when the local bridge is unavailable.
- While mounted, creasekit synchronizes the current selection, annotations, and replies to the local authenticated Vite bridge automatically, even when the overlay is hidden. Hiding the overlay is not a privacy boundary.
- The bridge keeps synced context in memory for 15 minutes after the latest sync. Destroying the creasekit mount requests removal; if that fails, context expires instead. Stopping the Vite development server clears all context.
- Agent replies, deletes, and clears change annotations through the loaded browser and do not run project commands or modify project files directly. Successful mutations wait for browser acknowledgement. Agent mutations reset local undo history.
- Model values and scoped history never enter saved annotation storage. They can appear in copied output or MCP context only after you opt in.
- New element captures exclude form values and URL query strings and fragments. Developers can mark private text with `data-creasekit-private`. These safeguards do not make arbitrary text safe to sync, so review annotations, replies, and context first.

For local connection requirements, session-file handling, limits, and lifecycle behavior, see [MCP sharing and privacy](MCP.md#sharing-and-privacy).

## Troubleshooting

| Symptom                                             | What to do                                                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clicking a button selects it instead of running it. | Close creasekit with its icon or `Alt+Shift+C`, then use the button.                                                                                                                                  |
| The overlay does not appear.                        | Confirm `creasekit()` is in the Vite plugin list and automatic mounting is enabled, then restart the application's Vite dev server.                                                                   |
| No FoldKit section appears.                         | The selected source may be outside supported instrumentation patterns, uninstrumented, or marked private. Check the automatic-context guide; explicit adapters still require a matching registration. |
| Agent context is unavailable.                       | Keep the browser page loaded with creasekit mounted. Confirm the local Vite server and MCP client use the same configured root, then wait for the next sync retry.                                    |
| An agent mutation does not apply.                   | Keep the browser loaded and check the local bridge. The MCP call completes only after the browser acknowledges the mutation; retry after the bridge reconnects.                                       |
| creasekit reports “Storage unavailable.”            | Copy feedback before closing or reloading. Annotations still work in memory, but the browser could not save them.                                                                                     |
| Copying fails.                                      | Use the selectable output that creasekit opens and copy it manually. Browser clipboard access may require permission.                                                                                 |
| An annotation's element is gone.                    | Review its saved context in **Feedback**. Edit or delete the annotation there.                                                                                                                        |
| A panel is in the way.                              | Press `Escape` to dismiss it. Repeated presses clear the selection and then exit inspection.                                                                                                          |
