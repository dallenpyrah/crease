import type { AgentConnection } from './agent-contract';
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
            selector: '[data-crease-target="playground-increment"]',
            events: [{ event: 'click', message: Message.ClickedIncrement()._tag }],
          },
          {
            selector: '[data-crease-target="playground-decrement"]',
            events: [{ event: 'click', message: Message.ClickedDecrement()._tag }],
          },
          {
            selector: '[data-crease-target="playground-reset"]',
            events: [{ event: 'click', message: Message.ClickedReset()._tag }],
          },
          { selector: '[data-crease-target="playground"]', events: [] },
        ],
        project: (model) => ({ playgroundCount: model.playgroundCount }),
      },
    ],
  });

  const post = async (path: string, value: unknown): Promise<void> => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      credentials: 'same-origin',
      keepalive: path.endsWith('unshare'),
    });
    if (!response.ok && !(path.endsWith('unshare') && response.status === 404))
      throw new Error(`Crease bridge request failed (${response.status})`);
  };
  const agent: AgentConnection = {
    share: (snapshot) => post('/__crease/share', snapshot),
    unshare: (runtimeId) => post('/__crease/unshare', { runtimeId }),
  };
  return { foldkit, agent };
};
