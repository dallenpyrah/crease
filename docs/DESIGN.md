# Crease — homepage and product design brief

Status: implemented Mesurer-led redesign, September 9, 2026. The user's later direction supersedes the original hybrid brief below.

## Implemented direction

Match Mesurer's white, single-column homepage and upper-left white icon toolbar, while keeping Crease's name and FoldKit implementation. At a 1440px viewport, both live pages measure a 672px column at x=384, intro heading at y=170.5, Features at y=277.625, and How to use at y=852.125. Use locally served Inter, 15px body text, 16px feature icons, an 8px list gap, and 56px section gaps. The supplied screenshot's blue wash is a selected-element overlay, not a background color.

The overlay uses compact 320px white anchored cards, thin blue element outlines and dimension labels, a bright blue active-tool state, tooltips and keyboard shortcuts, and a 400px feedback panel with Notes/Markdown/JSON tabs. The real tools include inspect, element notes, typography, computed color copying, rulers, capped X-ray, Alt spacing, persistent note pins, note undo/redo, and settings. No inactive placeholders advertise unimplemented arrows, pen, guides, screenshots, extension distribution, or MCP connectivity.

The two homepage cards lead to the real FoldKit playground and show the local mounting API, rather than claiming a published npm package or Chrome extension. Mobile keeps the same visual language with a 350px content column at a 390px viewport, wrapping feature descriptions, stacked cards, and viewport-clamped panels.

The final Crease mark is a modular C with a green folded corner, derived from FoldKit's geometric visual language. A single SVG supplies the homepage, toolbar, and favicon; it adapts for dark browser tabs. The inspector shows the FoldKit section only when actual registered context exists—no empty heading, divider, or unavailable-scope message. Registered source/Message metadata is compact, with scoped Model/history opt-in. The Feedback panel exposes explicit share/revoke controls for Crease's own read-only Effect v4 MCP server in development.

## Original reference brief (superseded where it conflicts)

## Direction

Combine Agentation’s narrow editorial documentation layout with Mesurer’s live, precise inspection interface. Crease should look like a small, thoughtfully made developer tool: white space, real typography, quiet rules, compact controls, and visible product behavior. Avoid a generic SaaS landing page with giant gradients, oversized cards, or invented testimonials.

Match the references’ hierarchy and density, but create Crease’s own wordmark, icon, illustrations, copy, and interaction styling. Do not reuse Agentation’s logo, screenshots, demo artwork, or package code.

## What was actually observed

The supplied screenshots show Agentation with a left documentation rail, a small serif headline, a browser-frame demo, and numbered instructions. Mesurer has a centered text column, a floating upper-left toolbar, a plain feature list, and two installation cards.

At a 1440 × 1100 CSS-pixel viewport, live inspection found:

| Element              | Agentation                                                 | Mesurer                                             |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| Main reading region  | Starts around x=456; sections roughly 528px wide           | Starts around x=384; content roughly 672px wide     |
| Navigation / toolbar | Left rail around x=256; closed tool at lower right         | Compact floating toolbar at upper left              |
| Typography           | Inter body; hero IBM Plex Serif, 32px / 36.8px, weight 500 | Inter, 15px / 22.5px body; restrained headings      |
| Surface              | Nearly white, low-contrast borders, soft demo shadow       | Computed body background is white                   |
| Live interaction     | Click target → anchored dark comment composer              | Click typography target → small white property card |

The blue tint across the supplied Mesurer screenshot is not its live page’s base background. Use blue as an inspection/selection state, not a permanent full-page wash. These are observations at one viewport, not hardcoded requirements for Crease.

## Brand and copy

Use an original folded-corner/crease glyph: two or three simple strokes suggesting a sheet folded along one diagonal. Pair it with a small typographic `crease` wordmark and a restrained “for FoldKit” label. Keep the glyph legible at 16px; it is also the collapsed tool launcher.

Proposed hero:

> **Point at it. Tell your agent.**
>
> Inspect your FoldKit app, leave a note, and give your coding agent the context to make the change.

Primary action: **Try Crease**. Secondary action: **Install**. A small monospace installation command sits beside or below the actions only once a real package is published. Before publication, show a clearly labeled local setup guide rather than a nonfunctional copy command.

After source/MCP beta ships, a supporting line can read: “From the rendered element to its FoldKit source and Messages.” Do not claim that mapping on the clipboard-only alpha homepage.

## Page structure

```text
Desktop, centered shell

crease / for FoldKit       Point at it.
                          Tell your agent.
Overview                  Short explanation + Try / Install
Install
Inspect                   ┌──────────────────────────────────┐
Annotate                  │ Real FoldKit demo                │
Output                    │                                  │
                          │ selected target + 8px measure    │
Agents                    │        comment → copied context  │
MCP                       │               compact toolbar    │
Privacy                   └──────────────────────────────────┘

Resources                 How it works ──────────────────────
Changelog                 1. Point.  2. Comment.  3. Share.
GitHub
                          Inspect with precision ────────────
version                   Feedback your agent can use ───────
                          What gets shared ──────────────────
                          Install and connect ───────────────
                          FAQ / credits / license
```

1. **Hero:** short serif headline, plain sans-serif explanation, useful actions. Fit the beginning of the demo into the first desktop viewport.
2. **Interactive product demo:** an original mini FoldKit deployment/settings screen with two cards, a primary button, and a deliberate 8px spacing issue. The visitor selects a target, sees bounds/spacing, writes a note, and previews or copies the resulting context. Use the real package, not a marketing-only imitation.
3. **How it works:** three short steps with thin horizontal rules and small numbered markers. Explain the copy workflow before requiring MCP setup.
4. **Inspection features:** Mesurer-like icon/text rows for bounds, spacing, typography, guides, and X-ray, with shipped status reflected honestly. Avoid a large grid of empty feature cards.
5. **Agent context example:** a readable output panel displaying comment, target, measurement, source, and optional Message tag. Toggle Standard/Detailed only if both are real exports. Source/sample entries are labeled illustrative until generated by the actual demo.
6. **Privacy:** explain what stays local, what gets copied/shared, optional state capture, and the absence of agent access on the public demo.
7. **Install and connect:** two modest bordered panels: “Add to FoldKit” and “Connect your agent.” The second is a roadmap item until MCP support is shipped, not a working CTA. No browser-extension installation card at launch.
8. **FAQ and footer:** compatibility, development-only use, annotation storage, source limitations, browser support, licensing, changelog, and GitHub. Publish only links with actual destinations.

Documentation routes can grow from Overview and Install to Inspect, Annotate, Output, MCP, Privacy, and Changelog as each capability ships. Use the same shell and tokens rather than a separate documentation theme.

## Proposed layout and tokens

These are initial design values to validate visually, not extracted Crease styles.

| Token / constraint | Proposal                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| Desktop shell      | Max width 1040px; centered; top padding 64–80px                          |
| Rail               | 152px wide, 56–72px gap to content                                       |
| Main content       | 640–720px; prose narrower where useful                                   |
| Body type          | Inter or a licensed equivalent, 15–16px, line height 1.6                 |
| Display type       | IBM Plex Serif or a licensed equivalent, 38–44px desktop, 32–36px mobile |
| Code / dimensions  | IBM Plex Mono or system monospace, 12–13px                               |
| Surface / ink      | `#FFFFFF` / `#20211F`                                                    |
| Secondary text     | Start at `#696C68`, then verify contrast at actual sizes                 |
| Rule               | `#E7E9E5`; decorative, never the only state indicator                    |
| Brand accent       | Fold red, starting at `#C84343`                                          |
| Active inspection  | Blue `#1675E5`; pale selection fill with a sharp outline                 |
| Resolution         | Green plus a check and text label, never color alone                     |
| Radius             | 8–12px panels, 14–16px demo frame; rounded compact toolbar               |
| Spacing scale      | 4, 8, 12, 16, 24, 32, 48, 64, 80px                                       |
| Motion             | 120–180ms for tools/panels; reduced-motion alternative                   |

Self-host fonts with their required license files, use font-display swap, and limit weights. Define semantic StyleX variables for text, surface, border, active state, focus, and status. Share the vocabulary across site and inspector without forcing the inspector to inherit the host document’s variables.

**Desktop ≥1100px:** fixed/sticky rail, generous breathing room, bounded content width. Wider monitors gain margins rather than an enlarged hero.

**Tablet 768–1099px:** narrower rail or compact navigation header, demo spans available width, inspector panels clamp inside the viewport.

**Mobile <768px:** replace rail with a compact accessible menu; 20px page gutters; stack install panels; permit code blocks to scroll without page overflow. A selected annotation opens a bottom sheet rather than a tiny offscreen popover. Do not require hover or keyboard modifiers to use the demo.

## Inspector interaction design

Crease’s expanded toolbar has **Inspect**, **Measure**, **Annotate**, annotation count/list, **Copy**, agent status, settings, and collapse. Group additional tools behind a measure menu rather than packing every eventual feature into v0. Start with a light toolbar and support a tested dark theme later; Agentation’s dark composer is an inspiration, not a requirement to copy it.

- **Hover:** one-pixel blue outline, low-opacity fill, and compact `button · 104 × 40` label. The label avoids the pointer and viewport edges.
- **Selected:** persistent outline; target breadcrumb and ancestor picker; layout/type/color details live in one compact panel.
- **Annotating:** anchored composer with target summary, textarea, Cancel and Add. Enter makes a newline; Cmd/Ctrl+Enter submits. Restore focus on close, and keep the user’s draft if they accidentally leave selection mode.
- **Saved:** numbered pin plus list entry. Reopen to edit the note, view the capture, copy it, or change status. A detached target gets a visible broken-link state and Reattach action.
- **Sharing:** distinguish “Not connected,” “Ready to submit,” “Submitted,” and “Agent replied.” A submitted count does not become a green resolved count until resolution actually occurs.
- **Resolved:** checkmarked pin and thread summary; allow reopening. Do not hide or delete the evidence automatically.
- **Measurement:** expose a two-target mode and a clickable alternative to the Alt modifier. Say “edge distance” where appropriate rather than falsely labeling every distance CSS gap.

Global shortcuts are opt-in/configurable and ignored in input, textarea, contenteditable, and IME composition. Show shortcut hints in menus; do not steal plain `M`, `I`, or `A` from the host app by default. Escape unwinds the active interaction before collapsing the tool.

Buttons have accessible names, tooltips, and visible focus. The desktop visual icon can be small while its target is at least 32px; use at least 44px targets on touch. Status and errors need readable text and restrained live-region announcements. Test keyboard selection/list navigation and screen-reader composition, not only pointer operation.

## Demo behavior and public safety

The demo is scoped to a clearly bounded stage; it must not accidentally block navigation or annotate unrelated visitors’ data. Initialize it empty, offer “Load example feedback,” and provide Reset. Any prefilled examples are explicitly demo content.

Use an isolated demo runtime with synthetic, public-safe data. Enable the visual package explicitly in the site’s production build while disabling the MCP bridge, Model access, and background outbound sharing. Do not attempt to connect a visitor to localhost or prompt for an agent login. Their typed demo feedback remains local unless they click Copy/Download.

If the demo uses a same-origin iframe for isolation, keep its coordinate system and toolbar inside the frame and verify focus, resize, and clipboard permissions. If that cannot meet accessibility requirements, use an inline bounded stage. This is a Phase 0 validation choice, not an assumed browser capability.

## Visual acceptance

- At 1440px and 2000px, the page reads as a quiet documentation/product page; the sidebar, headline, and demo have the same relative restraint as the references.
- At 390px, navigation, the demo, composer, and output remain usable with no horizontal page overflow or offscreen controls.
- The live demo supports inspect → note → preview/copy with the actual package. A screenshot or autoplay video does not satisfy this gate.
- All active, focus, error, detached, submitted, and resolved states are distinguishable without color alone; normal text meets WCAG AA contrast.
- Animations respect reduced motion. No user action is required merely to stop decorative movement.
- Public copy advertises only shipped functionality. No borrowed branding, fabricated counts, testimonials, agent replies, or working install commands for unpublished packages.
- Before release, capture homepage desktop/mobile and inspector composer/measurement screenshots, and record the full feedback loop. Review those against this brief, not only a passing build.

References: [Agentation](https://www.agentation.com/), [Mesurer](https://mesurer.dev/), the two user-supplied screenshots, and local agent-browser inspection. Legal constraints and technical sources are in [RESEARCH.md](RESEARCH.md).
