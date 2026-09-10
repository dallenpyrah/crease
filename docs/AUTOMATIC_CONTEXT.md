# Automatic FoldKit context

creasekit 0.2.0 captures source, view, and scoped Model context without application registrations. Automatic integration currently targets FoldKit 0.158.2 and the FoldKit Vite plugin 0.20.2; other versions require verification rather than an assumption of compatibility.

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

The directory passed to `--cwd` must be the configured Vite root containing `.creasekit/mcp-session.json`. Review the feedback and choose **Share snapshot**. The MCP tools remain read-only and can only read explicitly shared snapshots; **Stop sharing** revokes the current snapshot.

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

Production builds of consuming apps do not inject the toolbar, source metadata registry, or development bridge. The repository's public site intentionally retains its visual overlay, but serves static files only.
