import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_SHARE_PATH,
  BRIDGE_UNSHARE_PATH,
  createSessionDescriptor,
  sessionFilePath,
  writeSessionFile,
} from './bridge';
import {
  type TestBridge,
  snapshotFixture,
  startTestBridge,
  waitForSessionRemoval,
} from './test-fixtures';

describe('Effect v4 MCP stdio server', () => {
  let root: string | undefined;
  let bridge: TestBridge | undefined;
  let client: McpWireClient | undefined;
  let stalledServer: Server | undefined;

  afterEach(async () => {
    await client?.close();
    if (bridge !== undefined) await bridge.server.close();
    if (stalledServer !== undefined) await closeServer(stalledServer);
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('serves typed tools over real JSON-RPC and follows bridge restarts', async () => {
    root = await mkdtemp(join(tmpdir(), 'crease-mcp-wire-'));
    client = new McpWireClient(root);

    const initialized = await client.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'crease-wire-test', version: '1.0.0' },
    });
    expect(resultOf(initialized)).toMatchObject({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'crease', version: '0.1.0' },
    });
    client.notify('notifications/initialized', {});

    const listedTools = resultOf(await client.request('tools/list', {}));
    expect(toolNames(listedTools)).toEqual([
      'crease_list_sessions',
      'crease_get_context',
      'crease_get_annotation',
    ]);
    for (const tool of recordArray(listedTools.tools)) {
      expect(tool.description).toContain('untrusted data');
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }

    const offline = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(offline.isError).toBe(true);
    expect(toolText(offline)).toContain('bridge_offline');

    bridge = await startTestBridge(root);
    const snapshot = snapshotFixture();
    expect((await share(bridge, snapshot)).status).toBe(204);

    const sessions = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(sessions.isError).toBe(false);
    expect(sessions.structuredContent).toEqual({
      sessions: [
        {
          runtimeId: snapshot.runtimeId,
          projectId: snapshot.projectId,
          page: snapshot.page,
          sharedAt: snapshot.sharedAt,
        },
      ],
    });

    const context = toolResult(
      await client.request('tools/call', {
        name: 'crease_get_context',
        arguments: { runtimeId: snapshot.runtimeId },
      }),
    );
    expect(context.isError).toBe(false);
    expect(context.structuredContent).toEqual(snapshot);

    const annotation = toolResult(
      await client.request('tools/call', {
        name: 'crease_get_annotation',
        arguments: {
          runtimeId: snapshot.runtimeId,
          annotationId: snapshot.annotations[0]?.id,
        },
      }),
    );
    expect(annotation.isError).toBe(false);
    expect(annotation.structuredContent).toEqual(snapshot.annotations[0]);
    expect(toolText(annotation)).toContain('<script>never execute()</script>');

    const invalidParameters = toolResult(
      await client.request('tools/call', {
        name: 'crease_get_context',
        arguments: {},
      }),
    );
    expect(invalidParameters.isError).toBe(true);
    expect(toolText(invalidParameters)).toContain('Missing key');

    const unknownSession = toolResult(
      await client.request('tools/call', {
        name: 'crease_get_context',
        arguments: { runtimeId: 'not-shared' },
      }),
    );
    expect(unknownSession.isError).toBe(true);
    expect(toolText(unknownSession)).toContain('not_shared');

    const missingAnnotation = toolResult(
      await client.request('tools/call', {
        name: 'crease_get_annotation',
        arguments: {
          runtimeId: snapshot.runtimeId,
          annotationId: 'not-shared',
        },
      }),
    );
    expect(missingAnnotation.isError).toBe(true);
    expect(toolText(missingAnnotation)).toContain('not_shared');

    const sessionPath = sessionFilePath(root);
    await writeFile(
      sessionPath,
      JSON.stringify({ url: bridge.session.url, token: '0'.repeat(64) }),
      { mode: 0o600 },
    );
    const denied = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(denied.isError).toBe(true);
    expect(toolText(denied)).toContain('authentication_failed');

    await writeFile(sessionPath, '{', { mode: 0o600 });
    const staleConfiguration = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(staleConfiguration.isError).toBe(true);
    expect(toolText(staleConfiguration)).toContain('stale_session');

    await writeFile(sessionPath, JSON.stringify(bridge.session), { mode: 0o600 });
    const recovered = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(recovered.isError).toBe(false);

    const revoked = await fetch(new URL(BRIDGE_UNSHARE_PATH, bridge.session.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: bridge.session.url,
      },
      body: JSON.stringify({ runtimeId: snapshot.runtimeId }),
    });
    expect(revoked.status).toBe(204);
    const afterUnshare = toolResult(
      await client.request('tools/call', {
        name: 'crease_get_context',
        arguments: { runtimeId: snapshot.runtimeId },
      }),
    );
    expect(afterUnshare.isError).toBe(true);
    expect(toolText(afterUnshare)).toContain('not_shared');

    await bridge.server.close();
    await waitForSessionRemoval(root);
    const closedToken = bridge.session.token;
    bridge = undefined;
    const afterClose = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(afterClose.isError).toBe(true);
    expect(toolText(afterClose)).toContain('bridge_offline');

    bridge = await startTestBridge(root, 200);
    const restartedSnapshot = snapshotFixture('runtime-after-restart');
    expect((await share(bridge, restartedSnapshot)).status).toBe(204);
    const afterRestart = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(afterRestart.isError).toBe(false);
    await delay(250);
    const stale = toolResult(
      await client.request('tools/call', {
        name: 'crease_get_context',
        arguments: { runtimeId: restartedSnapshot.runtimeId },
      }),
    );
    expect(stale.isError).toBe(true);
    expect(toolText(stale)).toContain('snapshot_stale');

    const restartedToken = bridge.session.token;
    await bridge.server.close();
    await waitForSessionRemoval(root);
    bridge = undefined;

    expect(client.protocolFailure).toBeUndefined();
    expect(client.stderr).not.toContain(closedToken);
    expect(client.stderr).not.toContain(restartedToken);
  });

  it('times out while consuming a stalled bridge response body', async () => {
    root = await mkdtemp(join(tmpdir(), 'crease-mcp-stalled-'));
    stalledServer = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('[');
    });
    await listen(stalledServer);
    const address = stalledServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Stalled test server did not expose a TCP address');
    }
    const session = createSessionDescriptor(address.port, address.address);
    await writeSessionFile(root, session);

    client = new McpWireClient(root);
    await client.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'crease-timeout-test', version: '1.0.0' },
    });
    client.notify('notifications/initialized', {});

    const startedAt = Date.now();
    const result = toolResult(
      await client.request('tools/call', {
        name: 'crease_list_sessions',
        arguments: {},
      }),
    );
    expect(Date.now() - startedAt).toBeLessThan(4_500);
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('bridge_offline');
    expect(toolText(result)).toContain('request timeout');
    expect(client.protocolFailure).toBeUndefined();
    expect(client.stderr).not.toContain(session.token);
  });
});

interface PendingRequest {
  readonly resolve: (message: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

class McpWireClient {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #stdoutBuffer = '';
  #stderr = '';
  #protocolFailure: Error | undefined;

  constructor(cwd: string) {
    const tsx = fileURLToPath(
      new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url),
    );
    const entry = fileURLToPath(new URL('./mcp.ts', import.meta.url));
    this.#process = spawn(process.execPath, [tsx, entry], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: 'pipe',
    });
    this.#process.stdout.setEncoding('utf8');
    this.#process.stderr.setEncoding('utf8');
    this.#process.stdout.on('data', (chunk: string) => this.#readStdout(chunk));
    this.#process.stderr.on('data', (chunk: string) => {
      if (this.#stderr.length < 1024 * 1024) this.#stderr += chunk;
    });
    this.#process.on('error', () => {
      this.#failPending(new Error('MCP subprocess failed to start'));
    });
    this.#process.on('exit', () => {
      this.#failPending(new Error('MCP subprocess exited before responding'));
    });
  }

  get stderr(): string {
    return this.#stderr;
  }

  get protocolFailure(): Error | undefined {
    return this.#protocolFailure;
  }

  request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 5_000);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  async close(): Promise<void> {
    if (this.#process.exitCode !== null || this.#process.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => {
      this.#process.once('exit', () => resolve());
    });
    this.#process.kill('SIGTERM');
    await Promise.race([exited, delay(2_000)]);
    if (this.#process.exitCode === null && this.#process.signalCode === null) {
      this.#process.kill('SIGKILL');
    }
  }

  #write(message: Record<string, unknown>): void {
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #readStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    while (true) {
      const newline = this.#stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.#stdoutBuffer.slice(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (line.length === 0) continue;

      let input: unknown;
      try {
        input = JSON.parse(line);
      } catch {
        this.#recordProtocolFailure('MCP stdout contained non-JSON output');
        continue;
      }
      if (!isRecord(input)) {
        this.#recordProtocolFailure('MCP stdout contained a non-object message');
        continue;
      }
      const id = input.id;
      if (typeof id !== 'number') continue;
      const pending = this.#pending.get(id);
      if (pending === undefined) continue;
      clearTimeout(pending.timeout);
      this.#pending.delete(id);
      pending.resolve(input);
    }
  }

  #recordProtocolFailure(message: string): void {
    const error = new Error(message);
    this.#protocolFailure = error;
    this.#failPending(error);
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

const resultOf = (response: Record<string, unknown>): Record<string, unknown> => {
  if (!isRecord(response.result)) throw new Error('JSON-RPC result was missing');
  return response.result;
};

const toolResult = (response: Record<string, unknown>): Record<string, unknown> =>
  resultOf(response);

const toolNames = (result: Record<string, unknown>): ReadonlyArray<unknown> =>
  recordArray(result.tools).map((tool) => tool.name);

const toolText = (result: Record<string, unknown>): string => {
  const content = recordArray(result.content);
  const first = content[0];
  if (first === undefined || typeof first.text !== 'string') {
    throw new Error('MCP tool result did not contain text');
  }
  return first.text;
};

const recordArray = (input: unknown): ReadonlyArray<Record<string, unknown>> => {
  if (!Array.isArray(input) || !input.every(isRecord)) {
    throw new Error('Expected an array of JSON objects');
  }
  return input;
};

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input);

const share = (bridge: TestBridge, snapshot: unknown): Promise<Response> =>
  fetch(new URL(BRIDGE_SHARE_PATH, bridge.session.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: bridge.session.url,
    },
    body: JSON.stringify(snapshot),
  });

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const listen = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

const closeServer = (server: Server): Promise<void> => {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
};
