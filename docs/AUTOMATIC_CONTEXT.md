# Automatic FoldKit context

creasekit captures source, view, and scoped Model context without application registrations. Automatic integration currently targets FoldKit 0.158.2 and the FoldKit Vite plugin 0.20.2; other versions require verification rather than an assumption of compatibility.

## Add automatic context to an existing app

Use Node.js 22.12 or later. Install creasekit as a development dependency in the consuming FoldKit application:

```bash
npm install -D creasekit
```

```bash
bun add -D creasekit
```

Add `.creasekit/` to the consuming application's `.gitignore`. Use the existing FoldKit plugin and append creasekit:

```ts
import { foldkit } from '@foldkit/vite-plugin';
import { creasekit } from 'creasekit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [foldkit(), creasekit()],
  server: { host: '127.0.0.1' },
});
```

Start the application's normal development command. The toolbar starts collapsed; open it with its button or `Alt+Shift+C`. No entry-module mount, `createFoldkitInspector` call, selector map, or application-written view/update wrapper is required.

Keep HTTP loopback enabled. This plugin does not expose an internet-facing MCP endpoint or override an unsafe server host.

## Inspect and annotate

Select an element to see its automatically captured FoldKit context:

- **View source** identifies the owning instrumented view.
- **Element source** identifies the original element-builder call site when that call was captured. A nearby ancestor's location is not presented as the selected element's exact creation site.
- **Scope** identifies the runtime/view and submodel slot, allowing instances of the same view to remain distinct.
- **Model supplied** identifies the expression and source location that supplied the Model. A declaration is shown only when it can be resolved; computed values are not assigned invented Model types or root paths.
- **Declared events** list concrete Message tags captured from declarative event attributes. Creasekit does not invoke an event callback to guess its result.

Enable **Include scoped Model & history** to include a bounded, sanitized snapshot of the Model associated with the rendered scope. This is not an analysis of every field the selected element depends on. If FoldKit is showing historical state, rendered-scope values describe that rendered view rather than claiming to be the latest live state.

Annotations freeze the context captured when the note is created. Their preview, Markdown/JSON export, and MCP snapshot retain that evidence instead of silently replacing it with later application state. Saved notes exclude Model values and history.

## Source-first agent output

**Copy for agent**, Markdown/JSON export, and the existing MCP context tools include the selected builder's project-relative file, enclosing symbol, original range, and bounded literal excerpt when verified. Positions are one-based and the end is exclusive. Owning view definitions and observed helper/submodel invocation sites are separate records: one shared builder may render many instances.

Up to four layout ancestors provide source locations where available, bounds, display, position, padding, border, gap, overflow, and scroll offsets. These measurements help an agent inspect container spacing without assuming the selected row should change. Unsupported parent mappings remain absent rather than borrowing another element's source.

The development server resolves supported StyleX references to their application and declaration spans. Conditional references remain candidates; an authored declaration match does not establish the winning computed CSS property. Runtime IDs and generated class names are not substitutes for authored source. In particular, helpers that retain only `stylex.props(...).className` can discard StyleX's optional source attribute.

Source excerpts are bounded and captured with the note. Copy and automatic sync validate source revisions again. Changed files produce stale evidence; unavailable mappings or a stopped development server do not produce a false current result. The resolver accepts registered instrumentation references, not arbitrary browser-supplied file paths. Source reads stay within the real project root and exclude credential files. Source excerpts and comments remain untrusted data, never instructions to execute.

## Browser reattachment and semantic location

The development observer adds opaque `data-creasekit-ref` attributes to supported instrumented DOM elements after rendering. They contain no source paths, Model values, or item keys. Existing app-authored attributes are preserved, and private regions are excluded.

Unique keyed source/view instances keep their references across consecutive renders within the same runtime, including keyed reordering and replacement DOM nodes. Unkeyed elements do not receive a made-up business identity: their references are tied to their DOM instances. On reset or runtime disposal, creasekit removes the attributes it owns. References are not durable across full reloads or guaranteed after an item leaves the rendered tree.

Annotations automatically capture the pathname, an available main heading, the nearest region's ARIA label or heading, the rendered sibling index, and explicit `aria-current` or `aria-selected` state. Generic tags are identified as tag fallbacks; creasekit does not invent names from generated CSS classes. Rendered position is not a database index or a claim about items outside a virtualized list.

Agent-facing Markdown prioritizes source evidence and readable location, not the short runtime reference. A missing or duplicated reference does not fall back to whichever row occupies the old position. A changed internal link destination also prevents reattachment to a recycled message row. Unsupported elements retain the existing selector fallback. Runtime item keys are kept private; rendered-sibling positions are not dataset indices or permanent identity.

## Exclude Model fields

Automatic capture already redacts sensitive-looking keys and omits accessors and functions. Add application-specific property names to exclude them at any depth:

```ts
creasekit({ excludeModelKeys: ['customerEmail', 'billingAddress'] });
```

Review the selected values before sharing. Key-based redaction is not a guarantee that a Model contains no private information, and source locations do not imply permission to share state.

## Connect an agent

Run the consuming application's installed binary to use its package version for the overlay, Vite bridge, and MCP launcher:

```json
{
  "mcpServers": {
    "creasekit": {
      "command": "/absolute/path/to/app/node_modules/.bin/creasekit",
      "args": ["--cwd", "/absolute/path/to/app"]
    }
  }
}
```

The directory passed to `--cwd` must be the configured Vite root containing `.creasekit/mcp-session.json`. Annotations sync automatically while the page is loaded. MCP can read, delete, and clear annotations; no manual sharing step is required.

## Existing manual integrations

The explicit registration API remains supported. If the application intentionally owns its overlay mount, disable automatic mounting and keep its existing mount and cleanup:

```ts
creasekit({ autoMount: false });
```

Automatic source instrumentation remains enabled. An explicitly supplied inspector takes precedence over the automatic default.

## Limits and troubleshooting

| Symptom                                        | Explanation or action                                                                                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No automatic toolbar appears.                  | Confirm `creasekit()` is in the Vite plugin list, automatic mounting is enabled, and the application is running in development over loopback HTTP. Restart Vite after changing its configuration.                                                                    |
| Only DOM details appear.                       | The selected code is outside the supported instrumentation patterns, comes from an uninstrumented dependency, or is marked private. Do not add a guessed source registration to disguise the missing information.                                                    |
| A Model declaration is absent.                 | Its supply site may be known without a unique declaration. Imported, derived, or generic Models can require more source resolution than is currently available.                                                                                                      |
| Runtime history is unavailable.                | The current automatic integration does not attach native DevTools history without an unambiguous runtime association. It does not force-enable `devTools` or infer causality from recent Messages. Explicit adapters retain their existing bounded history behavior. |
| A note is detached after HMR or a reload.      | Its old runtime identity or target can no longer be verified. The note and original evidence remain; creasekit does not silently move it to another same-source element.                                                                                             |
| A repeated element cannot be uniquely located. | Use FoldKit's normal stable keys and submodel slot IDs. Identical unkeyed nodes are not safely distinguishable from source location alone.                                                                                                                           |

Production builds of consuming apps do not inject the toolbar, source metadata registry, or development bridge. The repository's public site uses a separate, homepage-only build plugin to retain its overlay and embed an allowlisted static source manifest. It serves static files only: no filesystem endpoint, MCP session, or Model capture is enabled. Source freshness on that demo means matching the deployed build, not checking a live working tree. An annotation saved against an older source revision is marked stale when it differs from the current deployed manifest.

Notes created before the homepage had source capture retain their original DOM-only evidence. Reload the corrected homepage and create a new annotation to capture source; the demo does not invent historical source metadata for older notes.
