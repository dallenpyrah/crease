# Automatic FoldKit context and guided setup

Status: approved implementation plan for the unreleased 0.2.0 work. See [Automatic FoldKit context](AUTOMATIC_CONTEXT.md) for implemented behavior and current limits. This document does not describe capabilities available in creasekit 0.1.0 or authorize publication or Railway deployment.

## Goal

An application developer installs creasekit and adds `creasekit()` alongside the existing `foldkit()` Vite plugin. In development, creasekit mounts automatically. Annotating an element includes its verified source location, owning view, submodel instance, and optional scoped Model values without application-written registrations or wrappers.

Replace the public homepage's live playground and setup cards with a guided installation walkthrough. Show complete, copyable examples in readable code blocks instead of using a counter as the onboarding experience.

## Boundaries

- Implement everything in creasekit. Do not modify FoldKit upstream, patch installed dependencies, add React, or take over FoldKit's single DevTools overlay registration.
- Use development-only Vite instrumentation of consuming application source. Keep metadata separate from FoldKit's existing VNode identity, keys, and rendering behavior.
- Preserve the read-only, consent-based MCP snapshot workflow. Automatic discovery must not become automatic sharing.
- Remove manual registration from the default setup, but preserve the existing API as an optional compatibility path for current consumers and unusual integrations.
- Keep the existing loopback HTTP restriction. One-plugin setup does not eliminate the session-directory ignore rule, a running development server, or MCP client configuration.
- Do not add exact state-dependency analysis, agent-driven dispatch, time travel, drawing tools, or a public MCP service to this work.

## Evidence and remaining uncertainty

A local browser probe against `foldkit@0.158.2` and `@foldkit/vite-plugin@0.20.2` established the following without changing FoldKit or adding application registrations:

1. A creasekit-owned Vite transform can wrap an application's runtime configuration and `h.submodel` invocation in development.
2. The clicked DOM button can be matched to the returned VNode, its generated `app.ts#counterView` identity, the `primary-counter` slot, and the `{ count: 0 }` Model passed to the submodel.
3. After a real click, FoldKit's existing development protocol returns `{ count: 1 }`, the `GotCounterMessage` wrapper, the `ClickedIncrement` leaf tag, and the changed path `root.counter.count`.
4. These requests work over Vite's existing WebSocket connection without starting FoldKit's external MCP relay. The browser reported no runtime errors.

The probe used a single controlled fixture and targeted source replacements. It is not a production-ready transformer. Exact element call-site capture, Model declaration resolution, lazy views, hydration, multiple runtimes, and broad import patterns remain implementation and verification work. The successful `root.counter` protocol query used a known path; it did not prove automatic Model-path inference.

## Annotation context contract

Each field must distinguish observed runtime data, compiler-resolved source information, and unavailable information. A CSS match alone must never be described as verified FoldKit ownership.

| Context              | How creasekit obtains it                                                                                                                    | What the annotation may claim                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Element source       | Record the original file, line, and column of an instrumented element-builder call; associate its returned VNode with the rendered element. | The exact creation call site when captured, not merely the containing view's line.                                                                                |
| Owning view          | Resolve the executed view's source binding and corroborate its VNode identity when available.                                               | The view symbol and definition location. Record the element creation site separately when a helper creates the markup.                                            |
| Submodel instance    | Capture the existing `h.submodel` slot and its actual returned subtree.                                                                     | The selected instance and observed ownership chain, using existing keys where applicable.                                                                         |
| Rendered Model       | Capture the Model supplied to the owning runtime/view or submodel and serialize the selected scope only after consent.                      | The Model values associated with that rendered scope. A paused historical view must not be mislabeled as the latest live Model.                                   |
| Model source         | Resolve the expression supplied to the view/submodel and, when statically traceable, its type or schema declaration through imports.        | A verified declaration location when resolvable; otherwise show the model-supply location and expression without inventing a `Model` symbol or global state path. |
| Messages and changes | Read bounded history from FoldKit's existing development protocol when an unambiguous runtime connection is available.                      | Observed Messages and changed paths, not proof that the annotated element caused every recent update.                                                             |
| Event binding        | Capture declarative Message metadata from recognized handler construction when safe.                                                        | For example, a declared `OnClick` Message tag. Never execute an event callback with a fabricated event to discover its result.                                    |

An illustrative annotation should read like this; the names and locations below are an example, not probe output:

```text
Feedback: Increase the spacing around this button.
Element source: src/counter.ts:42:7
Owning view: Counter.view — src/counter.ts:31:1
Submodel instance: primary-counter
Model declaration: Counter.Model — src/counter.ts:8:1
Model supplied at: src/page.ts:56:12 — model.counter
Rendered Model: { "count": 3 } [included with consent]
Declared click Message: ClickedIncrement
```

If a value is unavailable, omit it from the agent payload or attach a precise availability reason. Do not substitute a guessed source location. The useful baseline is element source plus owning view; unavailable history must not prevent annotation.

## Implementation sequence

### 1. Establish a supported instrumentation boundary

Build representative consumer fixtures before expanding the transformer. Cover a root view, a real submodel, repeated keyed instances, a view helper, and imported definitions.

Use AST-based transforms with import and binding resolution, not textual matching on every function named `view` or every object named `h`. Instrument recognized runtime creation, view/submodel boundaries, and element-builder calls. Preserve expression evaluation count, `this`, function behavior, Model references, and returned VNode references. Do not proxy application Models or alter FoldKit's identity branding.

Record original source spans and compose source maps correctly with FoldKit's transform and the consuming Vite pipeline. Use a browser-side metadata registry rather than adding framework identity attributes to the application's DOM. Version-check the FoldKit behavior creasekit relies on and provide a clear unsupported-integration diagnostic.

**Acceptance:** a separate fixture with no creasekit imports in its application entry can identify an annotated button's actual builder location, view definition, and submodel slot while rendering and updating exactly as before. Inspect the transformed code and test that production output contains no creasekit instrumentation.

### 2. Make the Vite plugin own development startup

Extend `server/vite-plugin.ts` to inject a development-only virtual entry that mounts creasekit, creates its existing agent connection, and connects the metadata registry to the inspector. Derive a stable local project namespace without publishing an absolute filesystem path. Start the overlay collapsed so it does not intercept ordinary page interactions by default.

Install early enough to observe application startup. Dispose correctly on HMR, avoid duplicate overlays, and do not double-mount consumers still using `mountCreasekit`. Provide one documented opt-out for consumers that intentionally manage their own mount.

**Acceptance:** the target setup is the following plus the existing `.creasekit/` ignore rule. No `createFoldkitInspector`, hand-written selector map, `observeView`, `observeUpdate`, or entry-module mount is required.

```ts
import { foldkit } from '@foldkit/vite-plugin';
import { creasekit } from 'creasekit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [foldkit(), creasekit()],
  server: { host: '127.0.0.1' },
});
```

### 3. Associate selected elements with source and Model context

Implement the automatic inspector alongside the existing explicit adapter. Resolve a selected element through its live VNode/element association first, then its verified owning scope. Keep source call sites, view ownership, and runtime instance identity separate.

Refresh associations after rendering and remove stale ownership on disposal or HMR. Handle reused VNodes and lazy-cache hits without changing their identity. Preserve parent ownership for markup supplied through submodel slots rather than attributing it to the surrounding child. If a pattern is unsupported or ambiguous, retain ordinary DOM inspection and label the missing FoldKit context.

Resolve Model declarations through source bindings where possible. A supplied expression such as `deriveCounter(model)` is valid provenance, but it does not prove a unique root Model path or that every field contributes to the selected element.

Improve annotation reattachment using verified source, submodel/keyed-instance identity, and semantic DOM information. Do not attach to the first same-source match in a repeated list. Preserve a detached or ambiguous annotation until a unique match or explicit user reattachment exists.

**Acceptance:** two instances of the same view produce distinct annotations; reordering a keyed list does not move a note to the wrong item; source positions survive transforms; unresolved declarations are not fabricated.

### 4. Add bounded runtime enrichment and preserve privacy

Listen to FoldKit's existing development lifecycle and response events, using its exported protocol schemas. Route read-only requests to the correct browser connection and correlate responses by request ID. Allow only the model/history/schema reads needed by the annotation experience, with timeouts and bounded responses. Do not expose FoldKit's dispatch, replay, resume, or mutation operations through creasekit.

Do not associate a runtime with a selected element by page URL or title alone. Establish and test an unambiguous association; if the existing protocol cannot identify the matching runtime in a multi-runtime page, leave history unavailable rather than attach another application's state. Source and captured rendered-scope context must remain useful independently.

Respect `devTools: false`; do not force-enable it. Source/view instrumentation and consent-based rendered-scope context should remain available, while protocol history is reported as unavailable. Do not replace the application update function just to simulate history unless live dispatches can be distinguished from FoldKit's replay calls.

Keep Model values and history opt-in. Bound serialization, exclude functions and unsafe accessors, redact sensitive fields, and retain at most the relevant recent observations. Do not continuously serialize the entire application Model. Provide field exclusion controls without requiring a per-element registration map. Preview the exact values before sharing and omit state/history from persisted annotations.

**Acceptance:** no creasekit state/history snapshot is exported or persisted without consent; stopping sharing revokes the existing MCP snapshot; a disabled or unavailable FoldKit bridge does not break annotations; no cross-runtime state is attached.

### 5. Carry context through annotations, exports, and MCP

Update `src/foldkit-schema.ts`, the inspector, annotation capture, persistence sanitization, Markdown/JSON export, and MCP schemas together. The current schema accepts only `explicit-registration` provenance, so automatic context requires an intentional schema change rather than inserting extra unvalidated fields.

Keep old saved notes and the explicit integration readable through a tested compatibility decoder. Version the expanded wire contract when necessary and report incompatible client/bridge versions clearly. Freeze source and consented state context at annotation/share time; do not silently replace a note's evidence with a later live Model. Offer an explicit refresh when context becomes stale.

**Acceptance:** the overlay preview, copied Markdown/JSON, and MCP annotation agree on the element source, view, Model provenance, instance, and consented values. Existing note migration does not lose user comments.

### 6. Replace the public playground with guided setup

Update `src/main.ts` and `src/styles.ts` to remove the counter, its controls, the “Live playground” section, the “Try the playground” link, and both existing setup cards. Remove obsolete homepage counter state, Messages, styles, and manual registrations from `src/development.ts` and related wiring in `src/entry.ts`. Keep counter applications in test fixtures; removing the public demo must not remove integration coverage.

Replace “How to use” with numbered steps:

1. **Install:** show the Node prerequisite and copyable npm and Bun development-dependency commands.
2. **Configure Vite:** show a complete configuration using `foldkit()` and `creasekit()` with loopback HTTP, and a separate `.gitignore` block for `.creasekit/`.
3. **Start the application:** show the development command and explain how to open the toolbar in the consuming app.
4. **Annotate and review context:** explain the automatically captured source/view information, optional Model data, and Markdown/JSON handoff.
5. **Connect an agent, optionally:** show copyable MCP configuration, explain the consuming Vite root used by `--cwd`, and make “Share snapshot” and “Stop sharing” explicit.

Use semantic `pre`/`code` blocks with readable monospace text, preserved whitespace, file or language labels, and keyboard-accessible copy buttons. Show success only after clipboard writing succeeds; provide a selectable-text fallback and honest error feedback when permission is denied. Keep long code horizontally scrollable without widening the whole page on mobile. Match the existing restrained typography and spacing rather than redesigning the homepage.

Use one source of truth for displayed and copied snippet text, and run the displayed setup examples in a fresh consumer fixture. The public production site may keep its visual overlay, but it must not expose a development runtime bridge. Keep setup copy controls usable when inspection is off.

**Acceptance:** no public playground remains; every setup snippet is readable and copies exactly; the walkthrough works at desktop and narrow widths; the published page documents the version users can actually install. If the homepage ships before automatic integration, it must temporarily document the 0.1.0 mount step rather than advertise an unreleased flow.

## Verification and release gates

Run the repository's relevant checks and extend coverage for the new behavior:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:package
```

- **Transforms:** verify aliased imports, imported views, supported runtime entry points, helper-created elements, source maps, and unsupported patterns. Never transform unrelated APIs just because their names match.
- **Runtime:** verify submodel instances, keyed reordering, lazy views, slot ownership, HMR/disposal, multiple runtimes, and hydration. Treat any claimed support for these patterns as contingent on passing fixtures; degrade explicitly otherwise.
- **Privacy and compatibility:** verify consent off/on, exclusion, stale context, revocation, old annotations, protocol validation, request timeout, and package/bridge version mismatch.
- **Actual consumers:** install the packed package into a clean FoldKit application, follow the displayed walkthrough, annotate a real element, and verify the same context through the stdio MCP launcher. Repeat on the published artifact only after publication is authorized.
- **Production:** prove that a normal consumer build contains no injected overlay, metadata registry, scoped state capture, or MCP code. Separately build and inspect the static homepage container with no development bridge.
- **Homepage:** verify copy payloads and clipboard-denial behavior, keyboard access, code overflow, and the removal of the playground in browser screenshots at desktop and narrow widths.

Do not call the work complete if it only auto-mounts the overlay while source/Model context still requires manual registration. The release gate is a real annotation with verified element source and owning view, automatically observed scope, and truthful Model provenance.

Implement and validate locally first. Keep changes uncommitted until a commit or release is requested. Do not publish npm, push a tag, or deploy Railway as part of plan creation.

## Troubleshooting behavior to design

| Symptom                                                       | Required response                                                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| An element has DOM details but no FoldKit context.            | Explain whether its runtime/module is unsupported or uninstrumented; retain annotation functionality.                                        |
| A Model declaration cannot be resolved.                       | Show the verified model-supply expression and location, if available, instead of a guessed declaration.                                      |
| Runtime history is missing.                                   | Distinguish disabled DevTools, ambiguous runtime ownership, and a timed-out connection; do not request app registrations as the default fix. |
| A note cannot be uniquely reattached after HMR or reordering. | Mark it detached or ambiguous and offer explicit reattachment.                                                                               |
| Copying a setup example fails.                                | Keep the complete code selectable and show a failure state rather than “Copied.”                                                             |

## Current implementation references

- [Consumer setup](../README.md)
- [Explicit integration contract](FOLDKIT.md)
- [Vite plugin and protected bridge](../server/vite-plugin.ts)
- [Current inspector adapter](../src/foldkit-context.ts)
- [Annotation context schema](../src/foldkit-schema.ts)
- [Homepage](../src/main.ts)
- [Packed consumer checks](../scripts/package.test.mjs)
