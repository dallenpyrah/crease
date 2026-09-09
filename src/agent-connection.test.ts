import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentConnection } from './agent-connection';
import type { AgentSnapshot } from './agent-contract';

const snapshot: AgentSnapshot = {
  version: 1,
  runtimeId: 'test-runtime',
  projectId: 'test-project',
  page: 'http://127.0.0.1:5173/',
  sharedAt: 1,
  selection: null,
  annotations: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('browser agent connection', () => {
  it('posts only explicitly shared snapshots to the same origin', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const agent = createAgentConnection();

    expect(fetch).not.toHaveBeenCalled();
    await agent.share(snapshot);

    expect(fetch).toHaveBeenCalledWith('/__creasekit/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      credentials: 'same-origin',
      keepalive: false,
    });
  });

  it('keeps revocation requests alive and treats an absent snapshot as revoked', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      createAgentConnection().unshare('test-runtime'),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/__creasekit/unshare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeId: 'test-runtime' }),
      credentials: 'same-origin',
      keepalive: true,
    });
  });

  it('does not treat failed shares or unconfirmed revocations as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    await expect(createAgentConnection().share(snapshot)).rejects.toThrow('(404)');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(createAgentConnection().unshare('test-runtime')).rejects.toThrow(
      '(503)',
    );
  });
});
