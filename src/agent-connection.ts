import { Schema } from 'effect';

import { type AgentConnection, AgentSyncResponse } from './agent-contract.js';

const AGENT_SYNC_TIMEOUT_MS = 5_000;
const AGENT_WATCH_TIMEOUT_MS = 20_000;

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
    sync: async (request) => {
      const response = await fetch('/__creasekit/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        credentials: 'same-origin',
        keepalive: false,
        signal: AbortSignal.timeout(AGENT_SYNC_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`creasekit bridge request failed (${response.status})`);
      }
      if (
        response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
        'application/json'
      ) {
        throw new Error('creasekit bridge returned an invalid sync response');
      }

      let input: unknown;
      try {
        input = await response.json();
      } catch {
        throw new Error('creasekit bridge returned an invalid sync response');
      }

      try {
        const result = Schema.decodeUnknownSync(AgentSyncResponse)(input);
        const commandIds = new Set(result.commands.map(({ id }) => id));
        if (commandIds.size !== result.commands.length) throw new Error();
        for (const command of result.commands) {
          if (
            command.type === 'clear' &&
            new Set(command.annotationIds).size !== command.annotationIds.length
          ) {
            throw new Error();
          }
        }
        return result;
      } catch {
        throw new Error('creasekit bridge returned an invalid sync response');
      }
    },
    watch: async (runtimeId, signal) => {
      const response = await fetch('/__creasekit/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeId }),
        credentials: 'same-origin',
        keepalive: false,
        signal: AbortSignal.any([signal, AbortSignal.timeout(AGENT_WATCH_TIMEOUT_MS)]),
      });
      if (!response.ok) {
        throw new Error(`creasekit bridge request failed (${response.status})`);
      }
    },
  };
};
