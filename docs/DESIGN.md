# Design guide

Use these conventions when changing the creasekit overlay or repository demo. The interface should let someone identify a problem, describe the desired change, and review what they will share without losing the host page.

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

Anchor the inspector near the selected element without hiding the target or its dimension labels. Reposition panels after scrolling, resizing, or changing their content. On narrow screens, keep controls reachable rather than preserving a desktop position.

Use existing tooltips and shortcuts. Preserve visible keyboard focus, named controls, keyboard navigation between **Feedback** tabs, and `Escape` dismissal. Do not add controls for features that have no working action.

## Show context only when it exists

Unregistered elements get ordinary inspection data, not an empty FoldKit heading or an “unavailable” placeholder. Registered elements can show their source, Message metadata, and scope. Keep Model fields and observed history behind explicit consent.

Distinguish observations from conclusions. A registered source is developer-supplied context, not automatically discovered provenance. An observed update is not a causal trace from the selected element to an application Message. Make that distinction readable without filling the interface with implementation details.

## Make feedback and sharing understandable

Keep note creation, editing, resolution, and copying available without an MCP connection. Use the **Notes**, **Markdown**, and **JSON** tabs to help people review feedback before sending it elsewhere.

Use **Share snapshot** and **Stop sharing** for agent access. A captured snapshot does not update by itself, so show when the user needs to share again. Keep storage, clipboard, and connection failures visible and provide a next action instead of displaying a success state that has not been confirmed.

Explain agent access in terms of what people can do: an agent can read the snapshot they chose to share. Do not promote implementation details as product features. Keep the read-only, local-only, consent-based boundary clear.

## Check a visual change

Check the repository demo and overlay at desktop and narrow widths. Use the demo interaction with creasekit both open and closed. Select an ordinary heading and a registered control, enable Model and history, create a note, open **Feedback**, and move through controls with the keyboard.

Verify contrast, panel placement, target visibility, horizontal overflow, and the logo in the page, toolbar, and browser tab. Capture the result in a browser after the change; automated state and DOM tests alone cannot establish visual quality.
