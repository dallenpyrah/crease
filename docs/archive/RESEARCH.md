# Crease — research and source audit

> Historical research from before implementation. Claims about proposed work and upstream transport choices describe that investigation, not the current application. See the [contributor guide](../CONTRIBUTING.md) for the implemented boundaries and the [MCP guide](../MCP.md) to connect an agent.

Research date: September 9, 2026. This document distinguishes observed implementation, documentation claims, and proposed work. It does not claim that a Crease application or integration spike has been built.

## Method

- Used the installed **Context7 CLI** to resolve `/foldkit/foldkit`, `/effect-ts/effect`, and `/facebook/stylex`; queried FoldKit runtime/MCP/HtmlBuilder, the exact Effect `effect_4.0.0-rc.112` documentation ID, and StyleX Vite/attribute APIs.
- Used authenticated **Parallel CLI 0.9.3** search and extraction against primary FoldKit, StyleX, Agentation, and Mesurer documentation. Avoided deep-research jobs where source inspection answered the question directly.
- Checked npm registry metadata and inspected targeted FoldKit source at commit [`af3250e`](https://github.com/foldkit/foldkit/tree/af3250ec30c54dbfb60045220ad855af68b0a83d), whose package versions match the observed FoldKit/Vite package releases.
- Used **agent-browser CLI**, in separate local sessions, to inspect both homepages at 1440 × 1100, open Agentation’s annotation composer without submitting feedback, and open Mesurer’s typography readout. Read computed typography/layout and compared the live pages with both supplied screenshots.
- The Crease workspace was empty and was not a Git repository at the start. No existing application, tests, dependency lockfile, or upstream extension implementation was available locally.

Context7 and web indexes sometimes return older or mixed-version snippets. Prefer versioned source and registry peer constraints over a snippet’s apparent recency. CLI availability/authentication was verified without reading or exposing credential values.

## Findings that change the design

### 1. Agentation is a workflow reference, not code to port

The [homepage](https://www.agentation.com/) documents click-to-annotate, Markdown copy, optional MCP, agent replies, and resolution. It now also advertises source paths, React component hierarchy, styles, and a richer feedback lifecycle. These are not unique differentiators for Crease by themselves; accurate FoldKit provenance is the differentiator.

The repository’s [LICENSE](https://github.com/benjitaylor/agentation/blob/main/LICENSE) is headed **PolyForm Shield License 1.0.0** and explicitly says:

> You may not use the Software to provide a product or service that competes with the Software or any product or service offered by the Licensor that includes the Software.

It also includes documentation in its definition of Software. The homepage separately describes internal-use permission and asks commercial redistributors to contact the authors. For a competing Crease product, do not copy, fork, translate, or bundle Agentation’s implementation/assets under an assumption of permissive reuse. Build independently from observed product behavior. Any requested reuse needs permission or a qualified license review; this is an engineering constraint, not legal advice.

Agentation’s [MCP README](https://github.com/benjitaylor/agentation/blob/main/mcp/README.md) describes a browser-facing HTTP server on port 4747, MCP over stdio, SQLite persistence, and a blocking annotation-watch tool. Crease should copy the useful interaction concept, not that infrastructure: FoldKit already supplies its own browser/relay/MCP path, and the first release does not need an additional server or SQLite store.

### 2. Mesurer is broader than an element ruler

The [live site](https://mesurer.dev/) and [repository](https://github.com/ibelick/mesurer) describe bounds, typography, X-ray, guides, rulers, Alt distances, arrows, freehand pen, text annotations, object selection, persistence, undo/redo, color sampling, and screenshot capture. Both an npm component and Chrome extension are presented.

Its [`packages/mesurer/LICENSE`](https://github.com/ibelick/mesurer/blob/main/packages/mesurer/LICENSE) is MIT, copyright Julien Thibeaut, and requires preservation of the notice in copies or substantial portions. Reuse is possible subject to those terms, but importing a React-centered package would work against Crease’s intended stack. Prefer independently authored DOM geometry and evaluate specific reusable algorithms only when useful.

The site’s `portalTarget`, custom `persistence`, `onPersistenceError`, and `captureVisibleTab` options are good architectural signals: mounting, durable storage, and privileged screenshot acquisition are separate capabilities. Browser-extension screenshot support is not a capability an embedded npm overlay gets for free.

Despite the agent-feedback marketing, the inspected [package README](https://github.com/ibelick/mesurer/blob/main/packages/mesurer/README.md) and [public exports](https://github.com/ibelick/mesurer/blob/main/packages/mesurer/index.ts) do not document an Agentation-like annotation protocol, MCP server, or Markdown handoff. Treat Mesurer as the inspection/drawing reference, not an agent integration to reuse. Its README notes that package-based capture may require a tab-sharing prompt; screenshot capture is therefore a later permission-sensitive feature, not impossible without the extension.

### 3. AFS is a possible interchange target, not a free internal model

[AFS 1.1](https://www.agentation.com/schema) documents required fields including `id`, `comment`, `elementPath`, `timestamp`, `x`, `y`, and `element`; optional threads, intent/severity, source-adjacent context, and status; and event envelopes with a monotonic sequence.

Its lifecycle is `pending | acknowledged | resolved | dismissed`. Its `x` is a viewport percentage while `y` is document pixels or viewport pixels for fixed targets. These semantics differ from a consistent CSS-pixel capture plus element-relative pin anchor. A Crease export adapter must explicitly convert coordinates/status and test information loss rather than renaming fields.

The page invites independent implementations, but that does not by itself settle the reuse terms for all published schema/code artifacts under the repository license. Keep the internal contract original and versioned; review terms before distributing an AFS compatibility implementation. Crease has no need to masquerade FoldKit scopes as `reactComponents`.

### 4. Effect v4 is supported, with an exact moving pin

Registry queries returned `foldkit@0.158.2` and `@foldkit/vite-plugin@0.20.2`, each peering on `effect@4.0.0-rc.112`. The [FoldKit package manifest](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/package.json) confirms the pin.

At research time, Effect’s npm tags were `latest: 3.22.2`, `beta: 4.0.0-beta.107`, and `rc: 4.0.0-rc.112`. Therefore, neither an unqualified latest install nor copying an older getting-started beta pin is a safe setup recipe.

Context7’s versioned [service migration guide](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/migration/services.md) confirms `Context.Service` and explicit Layer construction. The [Schema migration guide](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/migration/schema.md) and [Schema source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/Schema.ts) support `Schema.optionalKey`, `Schema.Literals`, and the current decode/encode APIs. Version-specific tests remain necessary during implementation.

### 5. A separate FoldKit runtime is already a proven overlay pattern

[DevTools documentation](https://foldkit.dev/core/devtools) describes the separate Shadow DOM overlay. The current [overlay implementation](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/devtools/src/overlay.ts#L2505-L2525) creates a ShadowRoot, injects styles, and puts an HTMLElement inside it.

Later in that [same file](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/devtools/src/overlay.ts#L2590-L2606), `makeElement` creates the inspector runtime with `devTools: false` and scoped startup. This is stronger evidence than inferring isolation from an embedding API alone.

[Embedding docs](https://foldkit.dev/core/embedding) document `Runtime.embed` and idempotent `dispose`, including resource cleanup and restoration of the container. [makeElement’s type](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/src/runtime/makeElement.ts#L24-L53) expects `HTMLElement | null`, not a ShadowRoot. Use a container element inside the root.

### 6. MCP transport reuse is correct; extensibility is new work

The [MCP guide](https://foldkit.dev/ai/mcp) documents runtime listing, Model/history queries, replay, schema-validated dispatch, explicit runtime selection, and a default relay port of 9988. An open browser runtime is required; `devTools: false` disables its bridge, while omitting the Message Schema disables dispatch but not inspection/replay.

The actual transport chain is browser bridge → Vite HMR custom events → Vite relay → external WebSocket client → MCP stdio process. Relevant source:

- [`webSocketBridge.ts`](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/src/devTools/webSocketBridge.ts#L69-L73): request/response/event HMR channel names.
- [`Request` union](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/src/devTools/protocol.ts#L65-L110): fixed requests; no Crease or generic annotation request.
- [relay request decoder](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/vite-plugin-foldkit/src/index.ts#L467-L487): validates frames before forwarding.
- [MCP tools](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/devtools-mcp/src/tools.ts#L328-L527) and [server registration](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/devtools-mcp/src/server.ts#L21-L61): build a fixed tool list and dispatch by name.

The proposed `foldkit_ui_*` tools therefore need upstream schemas, browser implementations, compatible frame handling, and MCP registration. No public extension hook was found in the inspected entry points. The plan must not promise a drop-in plugin on the current versions.

### 7. Current view identity is not per-element source provenance

The [Vite transform](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/vite-plugin-foldkit/src/viewIdentity.ts#L304-L344) assigns module/function IDs, and [`brandViewResult`](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/src/brand/brand.ts#L14-L53) stamps a VNode’s `identity` if absent. That identity changes renderer compatibility and serves hydration correctness.

It does not provide an Element-keyed registry of exact call-site line/column, complete component ancestry, event labels, or Model paths. Add separate development metadata and renderer hooks. Never replace the existing identity with line-based annotation IDs or remove it from production under the mistaken belief that it is only DevTools metadata.

### 8. Messages are available at construction; relationships need care

[`OnClick`](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/src/html/index.ts#L1608-L1634) receives a concrete Message and closes over it before dispatch. That is a credible location for development tag metadata; scraping the rendered DOM cannot recover the closure’s value.

Other handlers derive Messages from events and cannot be evaluated safely just to learn their tag. [Submodel boundaries](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/src/html/boundary.ts) maintain runtime wrapping descriptors. [Serialized history](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/foldkit/src/devTools/protocol.ts#L23-L37) includes wrapper-tag `submodelPath`, leaf tags, changed paths, Commands, and Mounts.

These support contextual enrichment, but a wrapper path is not a Model accessor, and recent history is not proof that a selected button caused a particular Command. Preserve these distinctions in the UI and agent payload.

### 9. StyleX works without React, but Shadow DOM needs an asset strategy

Context7 and official documentation confirm [`stylex.props`](https://stylexjs.com/docs/api/javascript/props/) returns className plus an inline-style object, while [`stylex.attrs`](https://stylexjs.com/docs/api/javascript/attrs/) returns class plus a serialized style string. FoldKit’s `h.Class` and `h.Style` can be bridged through a small adapter; the adapter is proposed and not yet typechecked or browser-tested.

The official [`@stylexjs/unplugin`](https://stylexjs.com/docs/api/configuration/unplugin/) supports Vite, aggregated CSS, a development virtual stylesheet, and CSS reload support. It does not mean a document-level injected stylesheet automatically crosses Shadow DOM. Validate extracted overlay CSS loading, dynamic variables, cascade layers, HMR, CSP, and packed-consumer paths in the first spike.

Registry results were StyleX/unplugin `0.19.0`; the unplugin declares `unplugin ^2.3.11` as a peer. Match actual compiler/runtime versions when installing.

### 10. Richer local context requires transport hardening

The audited [relay setup](https://github.com/foldkit/foldkit/blob/af3250ec30c54dbfb60045220ad855af68b0a83d/packages/vite-plugin-foldkit/src/index.ts#L610-L630) calls `new WebSocketServer({ port })`, without an explicit host or authentication check in that constructor/connection path. This does not substantiate a claim of loopback-only authenticated access; the log string says localhost but does not enforce it.

This is a source-level finding, not a penetration test or a claim that a specific deployed app is exposed. Require a security review and loopback/auth/origin policy before expanding the channel to DOM content, comments, and selected application state. Do not expose the relay as a public preview.

## Open validation work, intentionally not claimed as proven

- FoldKit + current StyleX compiler + stylesheet delivery into a ShadowRoot, especially HMR and distribution assets.
- Exact per-element source transforms with chained source maps, aliased builders, helpers, third-party packages, lazy caches, hydration, and portals.
- A public registration contract connecting selected DOM nodes to runtime/boundary/Model context without scraping private state.
- Native dialog/popover top-layer behavior and strict CSP support.
- Upstream acceptance and compatibility/version negotiation for new protocol/tool variants and relay security changes.
- Real coding-agent client behavior for shared annotation reads, replies, resolution, and any watch/notification feature.
- Package name/scope ownership, Crease’s code license, optional AFS reuse terms, website domain, and deployment target.

Those are concrete Phase 0 and implementation acceptance gates, not reasons to delay the researched clipboard-first product plan.
