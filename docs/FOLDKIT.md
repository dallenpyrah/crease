# Register FoldKit context

This explicit adapter remains the integration path for published 0.1.0 and an optional override for later versions. The unreleased 0.2.0 implementation on `main` adds [automatic source and scoped Model context](AUTOMATIC_CONTEXT.md) without application registrations.

The creasekit overlay works without application registration. Add FoldKit context only when a selected element should expose developer-defined source context, event Message metadata, a narrow Model projection, or observed updates.

creasekit does not infer source ownership, event handling, or arbitrary Model values from rendered HTML. That boundary is intentional: source context is explicit developer metadata, not discovered provenance.

## Use the development-only integration pattern

Start from the [complete packed-consumer counter fixture](https://github.com/dallenpyrah/creasekit/tree/main/scripts/fixtures/foldkit-app). Its [`src/main.ts`](https://github.com/dallenpyrah/creasekit/blob/main/scripts/fixtures/foldkit-app/src/main.ts) defines the Model, Message union, `init`, `update`, and `view`; [`src/development.ts`](https://github.com/dallenpyrah/creasekit/blob/main/scripts/fixtures/foldkit-app/src/development.ts) registers the opt-in context; and [`src/entry.ts`](https://github.com/dallenpyrah/creasekit/blob/main/scripts/fixtures/foldkit-app/src/entry.ts) loads it only in development.

Before adapting the fixture, make sure the existing application satisfies these conditions:

- `init` returns an initial value with a `model` property.
- Messages have a string `_tag`, as the fixture's `defineMessageUnion` messages do.
- `update` returns the application's normal update result with a `model` property.
- `view` is the application's normal FoldKit view function.

The following files are complete fixture examples, not fragments to merge independently.

### `src/development.ts`

```ts
import { createAgentConnection, createFoldkitInspector } from 'creasekit';

import { Message, type Model } from './main';

export const makeDevelopmentIntegration = (initialModel: Model) => ({
  agent: createAgentConnection(),
  foldkit: createFoldkitInspector({
    initialModel,
    registrations: [
      {
        boundary: 'Counter',
        source: { file: 'src/main.ts', view: 'view' },
        targets: [
          {
            selector: '[data-counter-increment]',
            events: [{ event: 'click', message: Message.ClickedIncrement()._tag }],
          },
          {
            selector: '[data-counter-reset]',
            events: [{ event: 'click', message: Message.ClickedReset()._tag }],
          },
        ],
        project: (model) => ({ count: model.count }),
      },
    ],
  }),
});
```

### `src/entry.ts`

```ts
import { Runtime } from 'foldkit';

import { Model, init, update, view } from './main';

const integration = import.meta.env.DEV
  ? (await import('./development')).makeDevelopmentIntegration(init().model)
  : undefined;

const application = Runtime.makeApplication({
  Model,
  init,
  update: integration?.foldkit.observeUpdate(update) ?? update,
  view: integration?.foldkit.observeView(view) ?? view,
  container: document.getElementById('root'),
  devTools: false,
});

Runtime.run(application);

if (import.meta.env.DEV) {
  const { mountCreasekit } = await import('creasekit');
  const creasekit = mountCreasekit({
    projectId: 'packed-consumer',
    startOpen: true,
    ...integration,
  });
  import.meta.hot?.dispose(() => creasekit.destroy());
}
```

This keeps the inspector, agent connection, observation wrappers, and overlay out of the production path. If an application only needs visual inspection and notes, use the simpler development-only mount in the [consumer setup](../README.md#mount-the-development-overlay) instead.

## Choose registrations deliberately

Use a stable selector on the rendered target or one of its ancestors. creasekit matches the selected element with the closest registered ancestor. Registrations and targets are checked in order, so put narrower targets before broader ones when they overlap.

`source.file` must be a project-relative path. Absolute paths, parent-directory paths, and URL-like paths are rejected. The source and events in a registration are static descriptions supplied by the developer; they are not a runtime source lookup or causality trace.

## Limit what a user can share

The `project` function is an allowlist, not a Model dump. Return only the fields a reader needs to understand the requested change. creasekit redacts sensitive-looking key names and bounds values, but those safeguards are not a replacement for a narrow projection.

Model data and history appear only after the person using the overlay enables **Include scoped Model & history**. Those values are excluded from saved annotation storage. creasekit retains at most ten observed updates per registration and reports them as observations, not proof that the selected element caused a particular application Message.

If no registration matches a selected element, creasekit shows ordinary inspection data and omits the FoldKit section. This is the expected behavior; do not add a placeholder that suggests context was automatically discovered.

## Troubleshooting

| Symptom                                      | What to check                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No FoldKit context appears.                  | Confirm the selector matches the selected element or an ancestor, the inspector is passed to `mountCreasekit`, and a broader registration is not listed first. |
| The shown state never changes.               | Confirm the development integration wraps both `update` and `view`, and check that `project` returns the intended fields.                                      |
| A source path is rejected.                   | Use a project-relative path such as `src/cart.ts`; do not use an absolute path, `..`, or a URL.                                                                |
| The Model section is absent.                 | Enable **Include scoped Model & history** in the overlay. The source and event metadata remain visible without Model consent.                                  |
| History looks unrelated to a selected click. | It records updates observed in the registered scope, not an inferred element-to-Message causal chain.                                                          |
