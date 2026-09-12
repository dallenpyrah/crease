import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionDescriptor } from './bridge';
import { transformAutomaticContext } from './automatic-transform';
import { MAX_SOURCE_CONTEXT_BATCH, SOURCE_CONTEXT_PATH } from './source-evidence';
import {
  type TestBridge,
  startTestBridge,
  waitForSessionRemoval,
} from './test-fixtures';

describe('development source-context endpoint', () => {
  let root: string;
  let bridge: TestBridge;
  let source: NonNullable<
    ReturnType<typeof transformAutomaticContext>
  >['sourceReferences'][number]['source'];

  beforeEach(async () => {
    root = await mkdtemp(join(resolve('.'), '.creasekit-source-endpoint-'));
    await mkdir(join(root, 'src'));
    const code = `import { Runtime } from 'foldkit';
const Model = {};
const view = (model, h) => h.button([h.Class(model.className)], [model.label]);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    const path = join(root, 'src/main.ts');
    await writeFile(path, code);
    const transformed = transformAutomaticContext(code, path, root, {
      sourceEvidence: true,
    });
    const reference = transformed?.sourceReferences.find(
      (candidate) => candidate.attributesStart !== undefined,
    );
    if (reference === undefined) throw new Error('Missing source fixture reference');
    source = reference.source;
    bridge = await startTestBridge(root);
    const plugin = bridge.server.config.plugins.find(
      (candidate) => candidate.name === 'creasekit',
    );
    const hook = plugin?.transform;
    if (typeof hook !== 'object' || hook === null || !('handler' in hook)) {
      throw new Error('Missing configured source transform hook');
    }
    await Reflect.apply(hook.handler, undefined, [code, path, undefined]);
  });

  afterEach(async () => {
    await bridge.server.close();
    await waitForSessionRemoval(root);
    await rm(root, { recursive: true, force: true });
  });

  it('returns registered evidence in request order without browser credentials', async () => {
    const missing = { ...source, column: (source.column ?? 1) + 1 };
    const response = await post(bridge.session, { sources: [source, missing] });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toMatchObject({
      sources: [
        {
          ...source,
          status: 'current',
          snippetTruncated: true,
          snippet: 'h.button([h.Class(model.className)]',
        },
        { ...missing, status: 'unavailable', snippetTruncated: false },
      ],
    });
  });

  it('enforces POST JSON, exact same origin, loopback host, query, and batch limits', async () => {
    expect(
      (
        await fetch(new URL(SOURCE_CONTEXT_PATH, bridge.session.url), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sources: [source] }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          bridge.session,
          { sources: [source] },
          {
            origin: 'http://localhost:1',
          },
        )
      ).status,
    ).toBe(403);
    expect((await fetch(new URL(SOURCE_CONTEXT_PATH, bridge.session.url))).status).toBe(
      405,
    );
    expect(
      (
        await fetch(new URL(SOURCE_CONTEXT_PATH, bridge.session.url), {
          method: 'POST',
          headers: { origin: bridge.session.url, 'content-type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await post(
          bridge.session,
          { sources: [source] },
          {},
          `${SOURCE_CONTEXT_PATH}?unexpected=1`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(bridge.session, {
          sources: Array.from({ length: MAX_SOURCE_CONTEXT_BATCH + 1 }, () => source),
        })
      ).status,
    ).toBe(422);
    expect(
      (await post(bridge.session, { sources: [{ file: '../.env', view: 'view' }] }))
        .status,
    ).toBe(422);

    const invalidHost = await rawRequest(
      bridge.session,
      {
        host: 'evil.example',
        origin: 'http://evil.example',
      },
      source,
    );
    expect(invalidHost.status).toBe(403);
    expect(invalidHost.body).not.toContain(bridge.session.token);
  });
});

const post = (
  session: SessionDescriptor,
  body: unknown,
  additionalHeaders: Record<string, string> = {},
  path = SOURCE_CONTEXT_PATH,
): Promise<Response> =>
  fetch(new URL(path, session.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      origin: session.url,
      ...additionalHeaders,
    },
    body: JSON.stringify(body),
  });

const rawRequest = (
  session: SessionDescriptor,
  headers: Record<string, string>,
  source: unknown,
): Promise<{ readonly status: number | undefined; readonly body: string }> =>
  new Promise((resolveRequest, reject) => {
    const endpoint = new URL(session.url);
    const request = httpRequest(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: SOURCE_CONTEXT_PATH,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
      },
      (response) => {
        const chunks: Array<Buffer> = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolveRequest({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify({ sources: [source] }));
  });
