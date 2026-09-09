import { Runtime } from 'foldkit';

import { mountCrease } from './crease';
import { Message, Model, init, update, view } from './main';

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

const crease = mountCrease({
  projectId: 'crease-homepage',
  startOpen: true,
  ...(integration === undefined
    ? {}
    : { foldkit: integration.foldkit, agent: integration.agent }),
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => crease.destroy());
}

export { Message };
