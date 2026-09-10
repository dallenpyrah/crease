import { Runtime } from 'foldkit';

import { mountCreasekit } from './creasekit';
import { Message, Model, init, update, view } from './main';

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById('root'),
  devTools: false,
});

Runtime.run(application);

const creasekit = import.meta.env.PROD
  ? mountCreasekit({ projectId: 'creasekit-homepage' })
  : undefined;

if (import.meta.hot) {
  import.meta.hot.dispose(() => creasekit?.destroy());
}

export { Message };
