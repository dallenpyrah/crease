# Inspect an interface and leave feedback

Use Crease to identify an element, describe a change, and send that description with its captured context. Start the local app using the [README](../README.md#try-it-locally).

## Switch between inspection and normal use

The toolbar starts in inspection mode. While Crease is on, clicking an element selects it rather than activating it. Click the Crease icon, or press `Alt+Shift+C`, to turn the overlay off and use the page normally. Toggle it back on to inspect the result.

In the playground, turn Crease off before using **+**, **−**, or **Reset**. Turn it back on and select a control to see its bounds and registered FoldKit context.

## Inspect an element

Choose a tool, then click the element you want to inspect:

| Tool         | Shortcut | What you can read                                                              |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| Inspect      | `I`      | Dimensions, position, padding, margin, border, radius, and an element locator. |
| Typography   | `A`      | Font family, size, weight, style, line height, and letter spacing.             |
| Sample color | `P`      | Computed text and background colors. Click a swatch to copy its value.         |

Colors come from the element's CSS, not from screenshot pixels. Dimensions and rulers use CSS pixels.

To compare spacing, select one element, then hold `Alt` while hovering another. Crease shows the visible edge-to-edge distance. Use **Rulers** (`R`) for viewport coordinates or **X-ray** (`X`) to outline visible elements. On large pages, X-ray scans up to 2,000 elements and outlines up to 500.

Choose **Copy element** to copy the selected element's context without creating a note.

## Add and manage notes

1. Choose **Annotate** (`N`) and click an element. If it is already selected, choose **Add a note** in the inspector.
2. Describe the change you want. Include the intended result, such as “Add 12px below this heading,” rather than just “Fix spacing.”
3. Choose **Add note**, or press `Cmd/Ctrl+Enter`. A numbered pin marks the element.
4. Open **Feedback** to review your notes. Edit or delete a note, mark it resolved when the change is complete, or reopen it if more work is needed.

Use the undo and redo buttons in Feedback to reverse note changes. Outside text fields, `Cmd/Ctrl+Z` undoes a change and `Cmd/Ctrl+Shift+Z` redoes it. These controls affect annotations, not the host application.

If an element disappears, its note keeps the captured context. You can still edit or delete that note. **Settings → Show annotation pins** hides the pins without deleting the notes.

## Copy feedback to an agent or teammate

Open **Feedback** and choose **Markdown** for readable feedback or **JSON** for structured data. Review the preview, then choose **Copy for agent** and paste it into your destination. You do not need an MCP connection to use this workflow.

To let a coding agent read a snapshot directly, follow [Connect a coding agent](MCP.md).

## Include FoldKit context

Registered elements show their source file, view, scope, and event Message. A Message is the named event the application handles; for example, the playground's Reset control shows `ClickedReset`.

Choose **Include scoped Model & history** to include the application state fields that the developer registered, along with recent updates in that scope. This starts off. In the playground, the registered field is `playgroundCount`.

The history shows observed updates, not proof that the selected element caused a particular operation. Crease does not automatically discover source locations or arbitrary application state. An element without a matching registration still has ordinary inspection data, but no FoldKit section.

Disabling the Model option excludes those fields from subsequent exports and attempts to revoke an existing shared snapshot. Check the sharing status if that request fails. It cannot remove context that someone has already copied or read.

## Keep feedback private

- Notes stay in your browser until you copy or explicitly share them. Crease saves notes between reloads; undo history and visual settings last only for the current session.
- Model values and update history never go into saved annotation storage. They can appear in copied output or shared snapshots when you opt in.
- New element captures exclude form values and URL query strings and fragments. Developers can mark private text with `data-crease-private`. These protections do not make arbitrary text safe to share: review your notes and context first.

For snapshot expiry, revocation, and local connection requirements, see [MCP sharing and privacy](MCP.md#sharing-and-privacy).

## Troubleshooting

| Symptom                                             | What to do                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clicking a button selects it instead of running it. | Turn Crease off with its icon or `Alt+Shift+C`, then use the button.                                                                                    |
| No FoldKit section appears.                         | Try a playground control in the development app. Other elements need an explicit registration; production builds do not include the demo registrations. |
| Crease reports “Storage unavailable.”               | Copy your feedback before closing or reloading. Notes remain usable in memory, but the browser could not save them.                                     |
| Copying fails.                                      | Use the selectable output that Crease opens and copy it manually. Browser clipboard access may require permission.                                      |
| A note's element is gone.                           | Review its saved context in Feedback. Edit or delete the note there.                                                                                    |
| A panel is in the way.                              | Press `Escape` to dismiss it. Repeated presses clear the selection and then exit inspection.                                                            |
