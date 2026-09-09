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
