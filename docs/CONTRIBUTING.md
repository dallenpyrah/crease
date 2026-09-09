# Change or integrate Crease

Use this guide when changing Crease or adapting its local inspector to another FoldKit application. To inspect a page or share feedback without changing the implementation, start with the [README](../README.md).

Crease currently runs from this repository. It does not provide a published package or a drop-in browser extension. The existing homepage is the working integration example.

## Set up and check a change

Use Node 26, as specified in [`.nvmrc`](../.nvmrc). From the repository root, run:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. Keep the server on loopback; enabling access from other machines is not a supported way to test the agent connection.

Before handing off a change, run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The [GitHub workflow](../.github/workflows/check.yml) runs those checks on pushes and pull requests. Use `npm run test:ui` or `npm run test:server` for focused iterations. Check Markdown formatting with `npm run format -- --check README.md 'docs/**/*.md'`.

UI tests cover state transitions, rendered views, geometry, exports, persistence, and consent. Server tests cover sharing boundaries and the actual stdio MCP connection. For a visual or interaction change, also check the page in a browser: tests against a simulated document cannot establish contrast, panel positioning, or operating-system clipboard behavior.

## Find the relevant code

| Change                                       | Start here                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Homepage content, counter, or layout         | [`src/main.ts`](../src/main.ts), [`src/styles.ts`](../src/styles.ts), [`src/styles.css`](../src/styles.css) |
| Inspector controls and panel interactions    | [`src/crease.ts`](../src/crease.ts), [`src/geometry.ts`](../src/geometry.ts)                                |
| Note state, undo/redo, or saved feedback     | [`src/feedback.ts`](../src/feedback.ts), [`src/persistence.ts`](../src/persistence.ts)                      |
| Registered source, Messages, or scoped state | [`src/development.ts`](../src/development.ts), [`src/foldkit-context.ts`](../src/foldkit-context.ts)        |
| Runtime mounting and cleanup                 | [`src/entry.ts`](../src/entry.ts)                                                                           |
| Snapshot data or agent tools                 | [`src/agent-contract.ts`](../src/agent-contract.ts), [`server/mcp.ts`](../server/mcp.ts)                    |
| Local sharing, authentication, or expiry     | [`server/vite-plugin.ts`](../server/vite-plugin.ts), [`server/bridge.ts`](../server/bridge.ts)              |

## Register FoldKit context

Crease does not infer source files or Model ownership from rendered HTML. Add an explicit registration that connects stable element selectors to the source, event Messages, and state fields you want to expose.

For example, this module under `src/` registers the existing playground's Reset control:

```ts
import { createFoldkitInspector } from './foldkit-context';
import { init, Message } from './main';

export const foldkit = createFoldkitInspector({
  initialModel: init().model,
  registrations: [
    {
      boundary: 'Homepage / Counter',
      source: { file: 'src/main.ts', view: 'view' },
      targets: [
        {
          selector: '[data-crease-target="playground-reset"]',
          events: [{ event: 'click', message: Message.ClickedReset()._tag }],
        },
      ],
      project: (model) => ({ playgroundCount: model.playgroundCount }),
    },
  ],
});
```

Follow the runtime wiring in [`src/entry.ts`](../src/entry.ts): wrap the host's `update` with `foldkit.observeUpdate(update)`, wrap its `view` with `foldkit.observeView(view)`, and pass `foldkit` to `mountCrease`. The existing [`makeDevelopmentIntegration`](../src/development.ts) combines registrations with the agent connection, so extend it rather than mounting a second inspector in the demo.

Use project-relative source paths. Choose selectors that continue to identify the intended element after a render. Matching uses the closest registered ancestor, and registration order decides which match wins. Put narrower targets before broader ones when they overlap. The current API does not infer ownership for repeated or keyed component instances.

Project only the state fields a reader needs. Sensitive key names are redacted and values are bounded, but those safeguards do not replace a narrow projection. The inspector retains at most ten observed updates per registration and does not write Model values or history to saved annotation storage.

## Preserve the application boundary

The observation wrappers return the original update and view results. Keep inspector state out of the host Model and pointer measurements out of its update loop. Crease must not change the host's VNode identity or dispatch Messages on an agent's behalf.

Recent updates describe what the registered scope observed. Do not present them as proof that selecting an element caused a Command. Render the FoldKit section only when a registration provides context; keep it absent for unregistered elements.

[`src/entry.ts`](../src/entry.ts) loads the demo registration and agent connection only during development. Production builds keep the visual demo but exclude that development wiring. Preserve this separation when moving the integration to another application.

## Preserve the sharing boundary

The browser captures a snapshot only when the user asks to share. It sends the snapshot to Crease's routes on the existing local development server. The MCP process authenticates to that server and reads stored snapshots; it does not browse the DOM or stream the host Model.

[`creaseBridge()`](../server/vite-plugin.ts), configured in [`vite.config.ts`](../vite.config.ts), owns those routes. It validates browser origins and request bodies, enforces limits and expiry, and rejects non-loopback or HTTPS configurations. It keeps snapshots in memory and recreates the protected session descriptor on restart. No additional TCP listener is required.

Keep credentials out of browser data, logs, exports, and client configuration. Preserve consent checks for pending shares and clear reporting when a share or revocation cannot be confirmed. Treat captured text and notes as untrusted content, not instructions to execute.

For dependency changes, use the versions in [`package.json`](../package.json) and the lockfile. Check FoldKit's peer requirements before upgrading its runtime dependencies together; do not replace the pins with unrelated latest releases.

## Troubleshooting

| Symptom                                        | What to check                                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The new element has no FoldKit context.        | Confirm its selector matches, the registration is passed to `mountCrease`, and you are running the development app. Check for an earlier, broader registration. |
| Scoped state or history does not update.       | Confirm both runtime wrappers are connected and the projection includes the fields you expect to observe. Enable Model consent in the inspector.                |
| Styling differs between tests and the browser. | Preserve the existing test configuration's real stylesheet transform, then check the browser at desktop and narrow widths.                                      |
| The dev server rejects its host or protocol.   | Restore the local HTTP configuration in `vite.config.ts`. Do not bypass the bridge's safety checks to expose it remotely.                                       |

See the [design guide](DESIGN.md) for interface conventions and the [historical notes](archive/README.md) for the original investigation. Historical proposals are not current API contracts or release commitments.
