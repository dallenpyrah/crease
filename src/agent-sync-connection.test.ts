import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentConnection } from './agent-connection';
import type { AgentSnapshot } from './agent-contract';

const snapshot: AgentSnapshot = {
  version: 1,
  runtimeId: 'sync-runtime',
  projectId: 'sync-project',
  page: 'http://127.0.0.1:5173/',
  sharedAt: 1,
  selection: null,
  annotations: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser automatic agent sync connection', () => {
  it('posts snapshots and acknowledgements to the same-origin sync endpoint', async () => {
    const command = {
      id: 'delete-command',
      type: 'delete' as const,
      annotationId: 'annotation-1',
      createdAt: 10,
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { commands: [command] },
          { headers: { 'content-type': 'application/json; charset=utf-8' } },
        ),
      );
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', fetch);
    const agent = createAgentConnection();
    if (agent.sync === undefined) throw new Error('Sync implementation is missing');

    await expect(
      agent.sync({ snapshot, acknowledgedCommandIds: ['previous-command'] }),
    ).resolves.toEqual({ commands: [command] });
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(fetch).toHaveBeenCalledWith('/__creasekit/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot,
        acknowledgedCommandIds: ['previous-command'],
      }),
      credentials: 'same-origin',
      keepalive: false,
      signal: expect.any(AbortSignal),
    });
  });

  it('rejects malformed, mistyped, and duplicate command responses', async () => {
    const responses = [
      new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      Response.json(
        { commands: [{ id: 'bad', type: 'resolve', createdAt: 1 }] },
        { headers: { 'content-type': 'application/json' } },
      ),
      Response.json(
        {
          commands: [
            {
              id: 'duplicate',
              type: 'clear',
              annotationIds: [],
              createdAt: 1,
            },
            {
              id: 'duplicate',
              type: 'clear',
              annotationIds: [],
              createdAt: 1,
            },
          ],
        },
        { headers: { 'content-type': 'application/json' } },
      ),
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    ];
    const fetch = vi.fn();
    for (const response of responses) fetch.mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetch);
    const sync = createAgentConnection().sync;
    if (sync === undefined) throw new Error('Sync implementation is missing');

    for (const _response of responses) {
      await expect(sync({ snapshot, acknowledgedCommandIds: [] })).rejects.toThrow(
        'invalid sync response',
      );
    }
  });

  it('surfaces failed sync status without falling back to legacy sharing', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const sync = createAgentConnection().sync;
    if (sync === undefined) throw new Error('Sync implementation is missing');

    await expect(sync({ snapshot, acknowledgedCommandIds: [] })).rejects.toThrow(
      '(503)',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('opens an abortable same-origin command watch with a bounded heartbeat timeout', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', fetch);
    const watch = createAgentConnection().watch;
    if (watch === undefined) throw new Error('Watch implementation is missing');
    const controller = new AbortController();

    await expect(watch(snapshot.runtimeId, controller.signal)).resolves.toBeUndefined();
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(fetch).toHaveBeenCalledWith('/__creasekit/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeId: snapshot.runtimeId }),
      credentials: 'same-origin',
      keepalive: false,
      signal: expect.any(AbortSignal),
    });
  });

  it('propagates caller cancellation to an active command watch', async () => {
    const fetch = vi.fn().mockImplementation(
      (_path: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const watch = createAgentConnection().watch;
    if (watch === undefined) throw new Error('Watch implementation is missing');
    const controller = new AbortController();

    const watching = watch(snapshot.runtimeId, controller.signal);
    controller.abort();
    await expect(watching).rejects.toMatchObject({ name: 'AbortError' });
  });
});
