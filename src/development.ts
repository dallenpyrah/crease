import { createAgentConnection } from './agent-connection';
import { createFoldkitInspector } from './foldkit-context';
import { Message, type Model } from './main';

export const makeDevelopmentIntegration = (initialModel: Model) => {
  const foldkit = createFoldkitInspector({
    initialModel,
    registrations: [
      {
        boundary: 'Homepage / Counter',
        source: { file: 'src/main.ts', view: 'view' },
        targets: [
          {
            selector: '[data-creasekit-target="playground-increment"]',
            events: [{ event: 'click', message: Message.ClickedIncrement()._tag }],
          },
          {
            selector: '[data-creasekit-target="playground-decrement"]',
            events: [{ event: 'click', message: Message.ClickedDecrement()._tag }],
          },
          {
            selector: '[data-creasekit-target="playground-reset"]',
            events: [{ event: 'click', message: Message.ClickedReset()._tag }],
          },
          { selector: '[data-creasekit-target="playground"]', events: [] },
        ],
        project: (model) => ({ playgroundCount: model.playgroundCount }),
      },
    ],
  });

  return { foldkit, agent: createAgentConnection() };
};
