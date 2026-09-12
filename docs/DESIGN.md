# Design guide

Use these conventions when changing the creasekit overlay or repository demo. The interface should let someone identify a problem, describe the desired change, and review what reaches their local agent without losing the host page.

## Keep the host application separate

creasekit renders as an overlay with its own SVG layer and styles. Do not make it depend on a consuming application's stylesheet, layout system, or component structure. Do not add a consumer CSS import for overlay behavior.

The overlay must observe the application without changing it. Keep inspector state, pointer measurements, annotations, and sharing state outside the host Model and update loop. Preserve the host's VNode identity and interaction behavior when creasekit is closed.

## Keep the page quiet and the tools visible

The repository demo uses a white, single-column layout with a compact toolbar at the upper left. Keep the demo readable and usable; do not replace a working interaction with a decorative imitation. A consuming application keeps its own visual language, so the overlay should sit above it without trying to restyle it.

| Element            | Convention                                                      |
| ------------------ | --------------------------------------------------------------- |
| Main demo column   | At most 672px wide, with 20px side gutters on narrow screens.   |
| Typography         | Locally served Inter, 15px body text, and restrained headings.  |
| Section spacing    | 56px between major sections; 8px between feature rows.          |
| Cards and controls | Thin borders, clear focus states, and compact labels.           |
| Narrow screens     | Stack demo cards and keep inspector panels within the viewport. |

Use blue for active tools, selected-element outlines, and dimension labels, not as a page-wide background wash. Keep text and controls legible on both white and dark surfaces.

## Use one creasekit mark

[`src/assets/creasekit.svg`](../src/assets/creasekit.svg) is the shared source for the demo mark, toolbar icon, and favicon. Its geometric C and green folded corner must remain recognizable at small sizes. Preserve its dark-tab treatment instead of maintaining separate copies.

The design takes inspiration from [Mesurer](https://mesurer.dev/), but creasekit's mark and implementation are original. Inter ships with its [font license](../public/fonts/LICENSE-Inter.txt).

## Keep inspection separate from action

Selecting an element must not activate it. Make the creasekit toggle easy to find so people can return to normal page interaction. Inspection should not require creating a note.

Anchor the inspector near the selected element without hiding the target or its dimension labels. Reposition panels after scrolling, resizing, or changing their content. Let the toolbar move by its grip, and make the **Settings** and **Feedback** panels follow it while clamping them to the viewport. On narrow screens, keep controls reachable rather than preserving a desktop position.

Use existing tooltips and shortcuts. Suppress tooltips while the toolbar is being dragged and reposition them near viewport edges. Preserve visible keyboard focus, named controls, keyboard navigation between **Feedback** tabs, and `Escape` dismissal. Keep `Alt+Shift+H` and `Alt+Shift+C` hide/restore behavior unchanged. Do not add controls for features that have no working action.

## Show context only when it exists

Unregistered elements get ordinary inspection data, not an empty FoldKit heading or an “unavailable” placeholder. Registered elements can show their source, Message metadata, and scope. Keep Model fields and observed history behind explicit consent. Freeze annotation source captures when feedback is created, but keep the live selection synchronized with the page.

Distinguish observations from conclusions. A registered source is developer-supplied context, not automatically discovered provenance. An observed update is not a causal trace from the selected element to an application Message. Make that distinction readable without filling the interface with implementation details.

## Make feedback and agent access understandable

Keep feedback creation, editing, conversation replies, and copying available without an MCP connection. Use the **Conversations**, **Markdown**, and **JSON** tabs to help people review feedback. Do not add Resolve or Reopen controls or an open status. Make **Clear all** undoable, and capture the IDs being cleared so feedback added afterward is protected.

When the local agent connection is configured, sync the current selection, annotations, and conversation replies to the authenticated Vite bridge automatically while mounted, including when the overlay is hidden. Keep storage, clipboard, sync, and connection failures visible and provide a next action instead of displaying a success state that has not been confirmed. Successful MCP mutations must wait for browser acknowledgement, and agent mutations must reset local undo history.

Explain agent access in terms of what people can do: an agent can read the live context and reply to, delete, or clear annotations through the loaded browser. MCP does not run project commands or modify project files directly. Keep the local-only boundary clear, and distinguish the user's requested change from untrusted DOM text, annotation content, and conversation replies.

## Check a visual change

Check the repository demo and overlay at desktop and narrow widths. Use the demo interaction with creasekit both open and closed. Select an ordinary heading and a registered control, enable Model and history, create feedback, add a user reply, open **Feedback**, try **Clear all** and undo, and move through controls with the keyboard. Verify agent replies, deletes, and clears while the browser remains loaded, including with the overlay hidden.

Verify contrast, panel placement, target visibility, horizontal overflow, and the logo in the page, toolbar, and browser tab. Capture the result in a browser after the change; automated state and DOM tests alone cannot establish visual quality.
