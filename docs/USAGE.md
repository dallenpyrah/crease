# Use creasekit in your application

Use creasekit to inspect an element, describe a requested change, and review the context before copying or sharing it. First add the overlay and Vite plugin to your existing application by following the [consumer setup](../README.md#add-creasekit-to-an-existing-app). Open the application at its own Vite development URL; it does not need to use the repository demo's port.

## Switch between inspection and normal use

Open creasekit from its floating icon. When the overlay is open, it starts in **Inspect** mode, so clicking an element selects it instead of activating it. Click the creasekit icon, or press `Alt+Shift+C`, to close the overlay and use the page normally. Toggle it back on to inspect the result.

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

## Add and manage notes

1. Choose **Annotate** (`N`) and click an element. If it is already selected, choose **Add a note** in the inspector.
2. Describe the intended result, such as “Add 12px below this heading,” rather than only saying “Fix spacing.”
3. Choose **Add note**, or press `Cmd/Ctrl+Enter`. A numbered pin marks the element.
4. Open **Feedback** to review notes. You can edit or delete a note, mark it resolved when the change is complete, or reopen it if more work is needed.

Use the undo and redo buttons in **Feedback** to reverse annotation changes. Outside text fields, `Cmd/Ctrl+Z` undoes a change and `Cmd/Ctrl+Shift+Z` redoes it. These controls affect annotations, not the host application.

If an element disappears, its note keeps the captured context. You can still edit or delete that note. **Settings → Show annotation pins** hides pins without deleting notes.

## Copy feedback or share a snapshot

Open **Feedback** and choose **Markdown** for readable feedback or **JSON** for structured data. Review the preview, then choose **Copy for agent** and paste it into a coding agent or message to a teammate. This workflow does not require MCP.

To let a coding agent read a snapshot directly, choose **Share snapshot** in **Feedback** and configure a local MCP client as described in [Connect an MCP client](MCP.md). A snapshot does not refresh itself, so share again after changing the page, selection, or annotations. Choose **Stop sharing** to prevent later reads.

## Include optional FoldKit context

Registered elements can show their project-relative source file, view, scope, and event Message metadata. A Message is the named event that the application handles. If you enable **Include scoped Model & history**, creasekit includes only the state fields that the developer registered, along with recent observed updates in that scope.

That information is opt-in twice: developers must register it, and you must enable Model consent before it is captured. creasekit does not automatically discover source locations, Model ownership, or arbitrary application state. The history reports observed updates in the registered scope; it does not prove that selecting an element caused a particular Message or operation. An element with no matching registration still has ordinary inspection data, but no FoldKit section.

See [Register FoldKit context](FOLDKIT.md) to add registrations and observation wrappers to an application.

## Keep feedback private

- Notes stay in your browser until you copy or explicitly share them. creasekit saves notes between reloads; undo history and visual settings last only for the current session.
- Model values and update history never enter saved annotation storage. They can appear in copied output or shared snapshots only after you opt in.
- New element captures exclude form values and URL query strings and fragments. Developers can mark private text with `data-creasekit-private`. These safeguards do not make arbitrary text safe to share, so review notes and context first.
- Shared snapshots stay in the local development server's memory, expire after 15 minutes, and disappear when that server stops. Stopping sharing cannot remove information someone has already copied or read.

For local connection requirements, session-file handling, limits, and revocation behavior, see [MCP sharing and privacy](MCP.md#sharing-and-privacy).

## Troubleshooting

| Symptom                                             | What to do                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clicking a button selects it instead of running it. | Close creasekit with its icon or `Alt+Shift+C`, then use the button.                                                                                                     |
| The overlay does not appear.                        | Confirm the development-only mount runs after `Runtime.run(application)`, then restart the application's Vite dev server.                                                |
| No FoldKit section appears.                         | The selected element needs an explicit registration, and the mounted overlay must receive that inspector. Check for an earlier, broader registration that matches first. |
| The **Feedback** panel has no sharing controls.     | Add `creasekit()` to the existing Vite plugin list and mount with `agent: createAgentConnection()` in development. Keep the server on local HTTP loopback.               |
| creasekit reports “Storage unavailable.”            | Copy feedback before closing or reloading. Notes still work in memory, but the browser could not save them.                                                              |
| Copying fails.                                      | Use the selectable output that creasekit opens and copy it manually. Browser clipboard access may require permission.                                                    |
| A note's element is gone.                           | Review its saved context in **Feedback**. Edit or delete the note there.                                                                                                 |
| A panel is in the way.                              | Press `Escape` to dismiss it. Repeated presses clear the selection and then exit inspection.                                                                             |
