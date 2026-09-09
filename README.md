<img src="./src/assets/crease.svg" width="48" height="48" alt="Crease" />

# Crease

Point at a running FoldKit interface, inspect it, leave a note, and give your coding agent the context to make a change.

Crease includes a FoldKit/StyleX homepage, an isolated visual inspector, an explicit FoldKit context adapter, and its own **Effect v4 MCP server**. It is a local development prototype, not a published npm package or browser extension.

## Run locally

Use Node 26 (`nvm use`) and npm:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. The server deliberately binds to loopback and refuses a non-loopback address while the Crease bridge is enabled.

The toolbar starts in inspection mode. Click its Crease icon to turn it off and use the counter normally; turn it back on to inspect the same controls. `Alt+Shift+C` also toggles it.

## Inspect and annotate

- **Inspect (`I`)** shows bounds, box-model values, and a DOM locator.
- **Annotate (`N`)** attaches editable notes and numbered pins to elements. `Cmd/Ctrl+Enter` saves a note.
- **Typography (`A`)** shows computed font properties; **color (`P`)** copies computed foreground/background colors, not pixels sampled from a screenshot.
- **Rulers (`R`)** display viewport CSS pixels. **X-ray (`X`)** outlines up to 500 visible elements, with a scan cap of 2,000 nodes.
- Hold **Alt** while hovering another element to measure visible edge-to-edge distance from the selected element.
- **Feedback** provides note editing, deletion, resolve/reopen, undo/redo, Markdown/JSON previews, and clipboard export. Arrow keys move between the preview tabs.
- **Settings** controls pins, rulers, and consent to include registered Model fields and history. `Escape` dismisses the current panel before exiting inspection.

Notes are kept in browser storage. A storage failure leaves them usable in memory and displays a warning; a clipboard failure opens selectable output. Detached notes retain their captured context and can still be edited or deleted. Undo history and visual preferences last for the current session.

## FoldKit context

The development demo explicitly registers its counter boundary, source file/view, static click Messages, and the `playgroundCount` Model field. Selecting Reset shows `src/main.ts → view`, `ClickedReset`, and, after consent, the scoped Model and observed updates.

This is **explicit registration**, not inferred source instrumentation. An unregistered element still has DOM context but no invented FoldKit metadata. Recent scope updates are labeled as observations, not proof that a particular element caused a Command.

The integration seam is in [`src/development.ts`](src/development.ts):

```ts
const inspector = createFoldkitInspector({
  initialModel,
  registrations: [
    {
      boundary: 'Counter',
      source: { file: 'src/counter.ts', view: 'view' },
      targets: [
        {
          selector: '[data-counter-reset]',
          events: [{ event: 'click', message: 'ClickedReset' }],
        },
      ],
      project: (model) => ({ count: model.count }),
    },
  ],
});
```

Use `inspector.observeUpdate(update)` and `inspector.observeView(view)` at the development runtime boundary, then pass `foldkit: inspector` to `mountCrease`. The wrappers return the original update/view results unchanged; they observe only developer-projected fields, keep at most ten scope updates, and synchronize restored renders without inventing a Message. The application's original `update` and `view` stay independent and testable.

The homepage imports this wiring only in development. It is removed from the production website build. Crease does not enable host Message dispatch, scrape private FoldKit stores, change VNode identity, or add its inspector state to the host Model.

## Connect a coding agent

Keep `npm run dev` running. In Crease's Feedback panel, choose **Share snapshot**. Nothing is available to MCP before this explicit action. Share again to refresh a snapshot after making changes, or choose **Stop sharing** to revoke it.

Configure a stdio MCP client with:

```json
{
  "mcpServers": {
    "crease": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/crease", "run", "--silent", "mcp"]
    }
  }
}
```

Replace the path with your checkout. `--silent` keeps npm's banners out of the JSON-RPC stream. For a client launched from the repository, the equivalent command is `npm run --silent mcp`.

Crease owns this server. It uses `effect/unstable/ai/McpServer`, `Tool`, `Toolkit`, and `McpProtocol` from **Effect 4.0.0-rc.112**, plus the matching `@effect/platform-node` stdio transport. It does not depend on FoldKit's MCP server or the legacy Effect 3 `@effect/ai` package.

| Tool                    | Purpose                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `crease_list_sessions`  | Find snapshots explicitly shared by browser tabs.                                                           |
| `crease_get_context`    | Read a captured selection, notes, source/Message metadata, and any consented scoped state for a runtime ID. |
| `crease_get_annotation` | Read one annotation by runtime and annotation ID.                                                           |

These tools are read-only. There is no arbitrary evaluation, shell execution, file-reading tool, or remote Model/Message mutation. Source locations are references for an agent that already has authorized access to the project.

### Sharing boundaries

- Snapshots live only in Vite's memory, expire after 15 minutes, and disappear on server restart. They are captured handoffs, not continuous live Model streams.
- The bridge uses the existing Vite HTTP listener. Browser writes require matching loopback Host/Origin headers and JSON content; MCP reads require a per-server bearer credential.
- Vite creates a protected `.crease/mcp-session.json` file with directory mode `700` and file mode `600`. The MCP process discovers it locally and rereads it for each request. **Do not copy or commit this file.** It is ignored by Git and never sent to the browser or included in exports.
- The bridge limits requests to 128 KiB, snapshots to 100 annotations, and concurrent shared sessions to 20. Oversized snapshots are rejected rather than silently truncated.
- Model/history export is opt-in and restricted to the registered projection. Sensitive key names are redacted; projections and history are bounded. Model/history values are never written to annotation storage.
- URL queries/fragments and form values are excluded from new DOM captures. Mark private DOM regions with `data-crease-private` to exclude their text. Inspect context before sharing it.
- Revoking Model consent also attempts to revoke a shared snapshot, including a share still in flight. If the server cannot confirm a request, the UI reports that uncertainty rather than claiming success.

Remote/tunneled development is intentionally unsupported by the bridge. Public website builds contain the demo inspector, but no development registrations or active agent bridge.

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run test:ui` runs FoldKit **Story** tests for counter and annotation state transitions, **Scene** tests against the real homepage view, and DOM/geometry/export/privacy regression tests. Scene rendering uses the real StyleX transform, not mocked classes. `npm run test:server` runs Node bridge/security tests and real subprocess JSON-RPC tests against the Effect v4 server.

The GitHub workflow runs these checks on pushes and pull requests. Browser geometry and appearance also need real-browser verification; Story/Scene and simulated DOM tests do not prove visual contrast or pixel layout.

## Scope

Implemented: inspection, typography, computed colors, rulers, X-ray, Alt distances, element notes/pins, note lifecycle/history, exports, explicit FoldKit context, and consented read-only MCP snapshots.

Not implemented: automatic source instrumentation, per-keyed-instance renderer registration, causal Command tracing, drawing/arrows/guides, screenshot capture, a browser extension, cloud/team sync, or agent-driven annotation mutations.

The visual design references Mesurer; the implementation and Crease mark are original. Inter is bundled under its [SIL Open Font License](public/fonts/LICENSE-Inter.txt).
