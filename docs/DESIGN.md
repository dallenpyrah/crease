# Design guide

Use these conventions when changing Crease's homepage or inspector. The interface should let someone point to a problem, describe the intended change, and review what they will share without losing sight of the page.

## Keep the page quiet and the tools visible

The homepage uses a white, single-column layout with a compact toolbar at the upper left. Keep the feature list readable and the counter usable; do not replace the working demo with a decorative imitation.

Current layout values live in [`src/styles.ts`](../src/styles.ts) and [`src/styles.css`](../src/styles.css):

| Element            | Convention                                                          |
| ------------------ | ------------------------------------------------------------------- |
| Main column        | At most 672px wide, with 20px side gutters on narrow screens.       |
| Typography         | Locally served Inter, 15px body text, and restrained headings.      |
| Section spacing    | 56px between major sections; 8px between feature rows.              |
| Cards and controls | Thin borders, clear focus states, and compact labels.               |
| Narrow screens     | Stack homepage cards and keep inspector panels within the viewport. |

Use blue for active tools, selected-element outlines, and dimension labels, not as a page-wide background wash. Keep text and controls legible on both white and dark surfaces, especially the counter's three buttons.

## Use one Crease mark

[`src/assets/crease.svg`](../src/assets/crease.svg) is the shared source for the homepage mark, toolbar icon, and favicon. Its geometric C and green folded corner must remain recognizable at small sizes. Preserve its dark-tab treatment instead of maintaining separate, drifting copies.

The design takes inspiration from [Mesurer](https://mesurer.dev/), but Crease's mark and implementation are original. Inter ships with its [font license](../public/fonts/LICENSE-Inter.txt).

## Keep inspection separate from action

Selecting an element must not activate it. Make the Crease toggle easy to find so people can return to normal page interaction. Inspection should not require creating a note.

Anchor the inspector near the selected element without hiding the target or its dimension labels. Reposition panels after scrolling, resizing, or changing their content. On narrow screens, keep controls reachable rather than preserving a desktop position.

Use the existing tooltips and shortcuts. Preserve visible keyboard focus, named controls, keyboard navigation between Feedback tabs, and `Escape` dismissal. Do not add controls for features that have no working action.

## Show context only when it exists

Unregistered elements get ordinary inspection data, not an empty FoldKit heading or an “unavailable” placeholder. Registered elements can show their source, Message, and scope. Keep Model fields and history behind explicit consent.

Distinguish observations from conclusions. An observed update is not a causal trace; a registered source is not automatically discovered provenance. Make that distinction readable without filling the main interface with implementation details.

## Make feedback and sharing understandable

Keep note creation, editing, resolution, and copying available without an agent connection. Use the Notes, Markdown, and JSON tabs to help people review feedback before sending it elsewhere.

Use **Share snapshot** and **Stop sharing** for agent access. A captured snapshot does not update by itself, so show when the user needs to share again. Keep storage, clipboard, and connection failures visible and provide a next action instead of displaying a success state that has not been confirmed.

Describe capabilities in terms of what people can do. Name implementation technologies only where readers need them to set up, integrate, troubleshoot, or understand an architectural decision. For example, explain that MCP lets an agent read shared feedback; do not promote the server's internal framework as a product feature.

## Check a visual change

Check the homepage and inspector at desktop and narrow widths. Use the real counter with Crease both on and off. Select an ordinary heading and a registered control, expand Model/history, create a note, open Feedback, and move through controls with the keyboard.

Verify contrast, panel placement, target visibility, horizontal overflow, and the logo in the page, toolbar, and browser tab. Capture the result in a browser after the change; automated state and DOM tests alone cannot establish visual quality.
