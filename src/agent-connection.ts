import type { AgentConnection } from './agent-contract.js';

export const createAgentConnection = (): AgentConnection => {
  const post = async (path: string, value: unknown): Promise<void> => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      credentials: 'same-origin',
      keepalive: path.endsWith('unshare'),
    });
    if (!response.ok && !(path.endsWith('unshare') && response.status === 404))
      throw new Error(`creasekit bridge request failed (${response.status})`);
  };

  return {
    share: (snapshot) => post('/__creasekit/share', snapshot),
    unshare: (runtimeId) => post('/__creasekit/unshare', { runtimeId }),
  };
};
