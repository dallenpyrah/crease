import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type AgentCommand,
  type AgentSnapshot,
  AgentSyncResponse,
} from '../src/agent-contract';
import {
  BRIDGE_COMMANDS_PATH,
  BRIDGE_CONTEXT_PATH,
  BRIDGE_SYNC_PATH,
  BRIDGE_WATCH_PATH,
  MAX_REQUEST_BODY_BYTES,
} from './bridge';
import {
  type TestBridge,
  snapshotFixture,
  startTestBridge,
  waitForSessionRemoval,
} from './test-fixtures';

describe('authenticated browser command bridge', () => {
  let root: string;
  let bridge: TestBridge;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'creasekit-command-'));
    bridge = await startTestBridge(root);
  });

  afterEach(async () => {
    await bridge.server.close();
    await waitForSessionRemoval(root);
    await rm(root, { recursive: true, force: true });
  });

  it('handshakes automatically and returns a mutation only after read-your-write acknowledgement', async () => {
    const snapshot = snapshotFixture('automatic-command');
    expect(await browserSync(bridge, snapshot)).toEqual({ commands: [] });

    const responsePromise = postCommand(bridge, {
      runtimeId: snapshot.runtimeId,
      type: 'delete',
      annotationId: snapshot.annotations[0]?.id,
    });
    const [command] = await waitForCommands(bridge, snapshot);
    expect(command).toMatchObject({
      type: 'delete',
      annotationId: snapshot.annotations[0]?.id,
    });

    const appliedSnapshot = { ...snapshot, annotations: [] };
    expect(await browserSync(bridge, appliedSnapshot, [command?.id ?? ''])).toEqual({
      commands: [],
    });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ command, snapshot: appliedSnapshot });

    const context = await getContext(bridge, snapshot.runtimeId);
    expect(context.status).toBe(200);
    expect(await context.json()).toEqual(appliedSnapshot);
  });

  it('redelivers unacknowledged commands with stable IDs', async () => {
    const snapshot = snapshotFixture('duplicate-delivery');
    await browserSync(bridge, snapshot);
    const responsePromise = postCommand(bridge, {
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    const first = await waitForCommands(bridge, snapshot);
    const second = (await browserSync(bridge, snapshot)).commands;
    expect(second).toEqual(first);

    const command = first[0];
    const appliedSnapshot = { ...snapshot, annotations: [] };
    await browserSync(bridge, appliedSnapshot, [command?.id ?? '']);
    expect((await responsePromise).status).toBe(200);
  });

  it('fails a clear acknowledged before its captured scope is applied', async () => {
    const snapshot = snapshotFixture('clear-race');
    await browserSync(bridge, snapshot);
    const responsePromise = postCommand(bridge, {
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    const [command] = await waitForCommands(bridge, snapshot);

    expect(await browserSync(bridge, snapshot, [command?.id ?? ''])).toEqual({
      commands: [],
    });
    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'command_not_applied' });
  });

  it('requires bearer authentication for writes and same origin for browser sync', async () => {
    const snapshot = snapshotFixture('authorization');
    await browserSync(bridge, snapshot);
    const endpoint = new URL(BRIDGE_COMMANDS_PATH, bridge.session.url);
    const body = JSON.stringify({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });

    const browserOnly = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: bridge.session.url,
      },
      body,
    });
    expect(browserOnly.status).toBe(401);

    const wrongToken = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${'0'.repeat(64)}`,
        'content-type': 'application/json',
      },
      body,
    });
    expect(wrongToken.status).toBe(401);

    const crossOriginSync = await fetch(new URL(BRIDGE_SYNC_PATH, bridge.session.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:1',
      },
      body: JSON.stringify({ snapshot, acknowledgedCommandIds: [] }),
    });
    expect(crossOriginSync.status).toBe(403);
    expect(crossOriginSync.headers.get('access-control-allow-origin')).toBeNull();

    const crossOriginWatch = await fetch(
      new URL(BRIDGE_WATCH_PATH, bridge.session.url),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:1',
        },
        body: JSON.stringify({ runtimeId: snapshot.runtimeId }),
      },
    );
    expect(crossOriginWatch.status).toBe(403);
  });

  it('wakes a long poll for queued work and releases its slot on disconnect', async () => {
    const snapshot = snapshotFixture('watch-disconnect');
    await browserSync(bridge, snapshot);
    const controller = new AbortController();
    const firstWatch = postWatch(bridge, snapshot.runtimeId, controller.signal).catch(
      (error: unknown) => error,
    );
    await delay(20);

    const overflow = await postWatch(bridge, snapshot.runtimeId);
    expect(overflow.status).toBe(429);
    controller.abort();
    await firstWatch;
    await delay(20);

    const activeWatch = postWatch(bridge, snapshot.runtimeId);
    const commandResponse = postCommand(bridge, {
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    expect((await activeWatch).status).toBe(204);
    const [command] = await waitForCommands(bridge, snapshot);
    await browserSync(bridge, { ...snapshot, annotations: [] }, [command?.id ?? '']);
    expect((await commandResponse).status).toBe(200);
  });

  it('preserves request limits and removes commands when their requester disconnects', async () => {
    const snapshot = snapshotFixture('cancel-command');
    await browserSync(bridge, snapshot);
    for (const type of ['reply', 'resolve']) {
      const malformed = await fetch(new URL(BRIDGE_COMMANDS_PATH, bridge.session.url), {
        method: 'POST',
        headers: commandHeaders(bridge),
        body: JSON.stringify({ runtimeId: snapshot.runtimeId, type }),
      });
      expect(malformed.status).toBe(422);
    }

    const oversized = await fetch(new URL(BRIDGE_COMMANDS_PATH, bridge.session.url), {
      method: 'POST',
      headers: commandHeaders(bridge),
      body: JSON.stringify({ value: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }),
    });
    expect(oversized.status).toBe(413);

    const controller = new AbortController();
    const cancelledRequest = fetch(new URL(BRIDGE_COMMANDS_PATH, bridge.session.url), {
      method: 'POST',
      headers: commandHeaders(bridge),
      body: JSON.stringify({
        runtimeId: snapshot.runtimeId,
        type: 'clear',
      }),
      signal: controller.signal,
    }).catch((error: unknown) => error);
    expect(await waitForCommands(bridge, snapshot)).toHaveLength(1);
    controller.abort();
    await cancelledRequest;

    await expectNoCommands(bridge, snapshot);
  });
});

const browserSync = async (
  bridge: TestBridge,
  snapshot: AgentSnapshot,
  acknowledgedCommandIds: ReadonlyArray<string> = [],
): Promise<AgentSyncResponse> => {
  const response = await fetch(new URL(BRIDGE_SYNC_PATH, bridge.session.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      origin: bridge.session.url,
    },
    body: JSON.stringify({ snapshot, acknowledgedCommandIds }),
  });
  if (!response.ok) throw new Error(`Browser sync failed (${response.status})`);
  return Schema.decodeUnknownSync(AgentSyncResponse)(await response.json());
};

const postCommand = (bridge: TestBridge, body: unknown): Promise<Response> =>
  fetch(new URL(BRIDGE_COMMANDS_PATH, bridge.session.url), {
    method: 'POST',
    headers: commandHeaders(bridge),
    body: JSON.stringify(body),
  });

const postWatch = (
  bridge: TestBridge,
  runtimeId: string,
  signal?: AbortSignal,
): Promise<Response> =>
  fetch(new URL(BRIDGE_WATCH_PATH, bridge.session.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      origin: bridge.session.url,
    },
    body: JSON.stringify({ runtimeId }),
    ...(signal === undefined ? {} : { signal }),
  });

const commandHeaders = (bridge: TestBridge): Record<string, string> => ({
  authorization: `Bearer ${bridge.session.token}`,
  'content-type': 'application/json; charset=utf-8',
});

const waitForCommands = async (
  bridge: TestBridge,
  snapshot: AgentSnapshot,
): Promise<ReadonlyArray<AgentCommand>> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { commands } = await browserSync(bridge, snapshot);
    if (commands.length > 0) return commands;
    await delay(5);
  }
  throw new Error('Timed out waiting for an agent command');
};

const expectNoCommands = async (
  bridge: TestBridge,
  snapshot: AgentSnapshot,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await browserSync(bridge, snapshot)).commands.length === 0) return;
    await delay(5);
  }
  throw new Error('Cancelled command remained queued');
};

const getContext = (bridge: TestBridge, runtimeId: string): Promise<Response> => {
  const endpoint = new URL(BRIDGE_CONTEXT_PATH, bridge.session.url);
  endpoint.searchParams.set('runtimeId', runtimeId);
  return fetch(endpoint, {
    headers: { authorization: `Bearer ${bridge.session.token}` },
  });
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
