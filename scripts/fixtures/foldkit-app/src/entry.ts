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
