import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_CONTEXT_PATH,
  BRIDGE_SHARE_PATH,
  BRIDGE_UNSHARE_PATH,
  MAX_ANNOTATIONS,
  MAX_REQUEST_BODY_BYTES,
  MAX_SESSIONS,
  type SessionDescriptor,
} from './bridge';
import {
  type TestBridge,
  annotationFixture,
  snapshotFixture,
  startTestBridge,
  waitForSessionRemoval,
} from './test-fixtures';
import { creasekit } from './vite-plugin';

describe('creasekit Vite development bridge', () => {
  let root: string;
  let bridge: TestBridge;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'creasekit-vite-'));
    bridge = await startTestBridge(root);
  });

  afterEach(async () => {
    await bridge.server.close();
    await waitForSessionRemoval(root);
    await rm(root, { recursive: true, force: true });
  });

  it('shares, reads, and explicitly revokes a captured handoff', async () => {
    const snapshot = snapshotFixture();
    const shared = await postJson(bridge.session, BRIDGE_SHARE_PATH, snapshot);
    expect(shared.status).toBe(204);
    expect(shared.headers.get('access-control-allow-origin')).toBeNull();

    const listed = await getContext(bridge.session);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([snapshot]);
    expect(listed.headers.get('cache-control')).toBe('no-store');

    const exact = await getContext(bridge.session, snapshot.runtimeId);
    expect(exact.status).toBe(200);
    expect(await exact.json()).toEqual(snapshot);

    const unshared = await postJson(bridge.session, BRIDGE_UNSHARE_PATH, {
      runtimeId: snapshot.runtimeId,
    });
    expect(unshared.status).toBe(204);
    expect((await getContext(bridge.session, snapshot.runtimeId)).status).toBe(404);
    expect(await (await getContext(bridge.session)).json()).toEqual([]);
  });

  it('denies invalid hosts, browser origins, and MCP credentials', async () => {
    const snapshot = snapshotFixture();
    const missingOrigin = await fetch(new URL(BRIDGE_SHARE_PATH, bridge.session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(missingOrigin.status).toBe(403);

    const crossOrigin = await postJson(bridge.session, BRIDGE_SHARE_PATH, snapshot, {
      origin: 'http://localhost:1',
    });
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get('access-control-allow-origin')).toBeNull();

    const invalidHost = await rawRequest(bridge.session, BRIDGE_SHARE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'evil.example',
        origin: 'http://evil.example',
      },
      body: JSON.stringify(snapshot),
    });
    expect(invalidHost.status).toBe(403);
    expect(invalidHost.body).not.toContain(bridge.session.token);

    const noToken = await fetch(new URL(BRIDGE_CONTEXT_PATH, bridge.session.url));
    expect(noToken.status).toBe(401);
    const wrongToken = await fetch(new URL(BRIDGE_CONTEXT_PATH, bridge.session.url), {
      headers: { authorization: `Bearer ${'0'.repeat(64)}` },
    });
    expect(wrongToken.status).toBe(401);

    const invalidMcpHost = await rawRequest(bridge.session, BRIDGE_CONTEXT_PATH, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${bridge.session.token}`,
        host: 'evil.example',
      },
    });
    expect(invalidMcpHost.status).toBe(403);
  });

  it('rejects non-JSON, malformed, schema-invalid, and oversized posts', async () => {
    const wrongMediaType = await fetch(new URL(BRIDGE_SHARE_PATH, bridge.session.url), {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        origin: bridge.session.url,
      },
      body: '{}',
    });
    expect(wrongMediaType.status).toBe(415);

    const malformed = await fetch(new URL(BRIDGE_SHARE_PATH, bridge.session.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: bridge.session.url,
      },
      body: '{',
    });
    expect(malformed.status).toBe(400);

    const invalidSnapshot = await postJson(bridge.session, BRIDGE_SHARE_PATH, {
      version: 2,
    });
    expect(invalidSnapshot.status).toBe(422);
    const invalidUnshare = await postJson(bridge.session, BRIDGE_UNSHARE_PATH, {
      runtimeId: 7,
    });
    expect(invalidUnshare.status).toBe(422);

    const oversized = await fetch(new URL(BRIDGE_SHARE_PATH, bridge.session.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: bridge.session.url,
      },
      body: JSON.stringify({ value: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }),
    });
    expect(oversized.status).toBe(413);
  });

  it('caps annotations and concurrent browser sessions', async () => {
    const annotations = Array.from({ length: MAX_ANNOTATIONS + 1 }, (_, index) =>
      annotationFixture(`cr_${index}`),
    );
    const encoded = JSON.stringify(snapshotFixture('too-many-notes', annotations));
    expect(Buffer.byteLength(encoded)).toBeLessThan(MAX_REQUEST_BODY_BYTES);
    const annotationOverflow = await postEncoded(
      bridge.session,
      BRIDGE_SHARE_PATH,
      encoded,
    );
    expect(annotationOverflow.status).toBe(422);

    for (let index = 0; index < MAX_SESSIONS; index += 1) {
      const response = await postJson(
        bridge.session,
        BRIDGE_SHARE_PATH,
        snapshotFixture(`runtime-${index}`),
      );
      expect(response.status).toBe(204);
    }
    const sessionOverflow = await postJson(
      bridge.session,
      BRIDGE_SHARE_PATH,
      snapshotFixture('one-too-many'),
    );
    expect(sessionOverflow.status).toBe(429);

    const replacement = await postJson(bridge.session, BRIDGE_SHARE_PATH, {
      ...snapshotFixture('runtime-0'),
      page: 'http://localhost/replaced',
    });
    expect(replacement.status).toBe(204);
  });
});

describe('creasekit bridge lifetime and binding', () => {
  it('returns stale after TTL expiry and then removes the snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'creasekit-vite-ttl-'));
    const bridge = await startTestBridge(root, 25);
    try {
      await postJson(bridge.session, BRIDGE_SHARE_PATH, snapshotFixture('short-lived'));
      await delay(40);
      expect((await getContext(bridge.session, 'short-lived')).status).toBe(410);
      expect(await (await getContext(bridge.session)).json()).toEqual([]);
    } finally {
      await bridge.server.close();
      await waitForSessionRemoval(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails configuration before binding to a non-loopback host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'creasekit-vite-host-'));
    try {
      await expect(
        createServer({
          root,
          configFile: false,
          logLevel: 'silent',
          server: { host: '0.0.0.0', port: 0 },
          plugins: [creasekit()],
        }),
      ).rejects.toThrow('requires server.host');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const postJson = (
  session: SessionDescriptor,
  path: string,
  body: unknown,
  additionalHeaders: Record<string, string> = {},
): Promise<Response> =>
  postEncoded(session, path, JSON.stringify(body), additionalHeaders);

const postEncoded = (
  session: SessionDescriptor,
  path: string,
  body: string,
  additionalHeaders: Record<string, string> = {},
): Promise<Response> =>
  fetch(new URL(path, session.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      origin: session.url,
      ...additionalHeaders,
    },
    body,
  });

const getContext = (
  session: SessionDescriptor,
  runtimeId?: string,
): Promise<Response> => {
  const url = new URL(BRIDGE_CONTEXT_PATH, session.url);
  if (runtimeId !== undefined) url.searchParams.set('runtimeId', runtimeId);
  return fetch(url, {
    headers: { authorization: `Bearer ${session.token}` },
  });
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const rawRequest = (
  session: SessionDescriptor,
  path: string,
  options: {
    readonly method: 'GET' | 'POST';
    readonly headers: Record<string, string>;
    readonly body?: string;
  },
): Promise<{ readonly status: number | undefined; readonly body: string }> =>
  new Promise((resolve, reject) => {
    const endpoint = new URL(session.url);
    const request = httpRequest(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path,
        method: options.method,
        headers: options.headers,
      },
      (response) => {
        const chunks: Array<Buffer> = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
