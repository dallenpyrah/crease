import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type AgentCommand,
  type AgentSnapshot,
  AgentSyncResponse,
} from '../src/agent-contract';
import { BRIDGE_SYNC_PATH } from './bridge';
import {
  type TestBridge,
  annotationFixture,
  snapshotFixture,
  startTestBridge,
  waitForSessionRemoval,
} from './test-fixtures';

describe('MCP annotation mutation tools', () => {
  let root: string | undefined;
  let bridge: TestBridge | undefined;
  let client: McpClient | undefined;

  afterEach(async () => {
    await client?.close();
    if (bridge !== undefined) {
      await bridge.server.close();
      if (root !== undefined) await waitForSessionRemoval(root);
    }
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('deletes and scoped-clears through acknowledged live browser state', async () => {
    root = await mkdtemp(join(tmpdir(), 'creasekit-mcp-mutations-'));
    bridge = await startTestBridge(root);
    client = new McpClient(root);
    await client.initialize();

    let snapshot = snapshotFixture('mcp-mutations');
    await browserSync(bridge, snapshot);
    const annotation = snapshot.annotations[0];
    if (annotation === undefined) throw new Error('Fixture annotation is missing');

    const deleteCall = client.callTool('creasekit_delete_annotation', {
      runtimeId: snapshot.runtimeId,
      annotationId: annotation.id,
    });
    const deletion = await waitForCommand(bridge, snapshot, 'delete');
    snapshot = { ...snapshot, annotations: [] };
    await browserSync(bridge, snapshot, [deletion.id]);
    expect(successContent(await deleteCall)).toEqual({
      command: deletion,
      snapshot,
    });

    const missingDelete = await client.callTool('creasekit_delete_annotation', {
      runtimeId: snapshot.runtimeId,
      annotationId: annotation.id,
    });
    expect(missingDelete.isError).toBe(true);
    expect(toolText(missingDelete)).toContain('not_shared');

    const first = annotationFixture('clear-first');
    const second = annotationFixture('clear-second');
    const concurrent = annotationFixture('clear-concurrent');
    snapshot = { ...snapshot, annotations: [first, second] };
    await browserSync(bridge, snapshot);
    const clearCall = client.callTool('creasekit_clear_annotations', {
      runtimeId: snapshot.runtimeId,
    });
    const clear = await waitForCommand(bridge, snapshot, 'clear');
    expect(clear).toMatchObject({
      annotationIds: ['clear-first', 'clear-second'],
    });

    snapshot = { ...snapshot, annotations: [first, second, concurrent] };
    expect((await browserSync(bridge, snapshot)).commands).toEqual([clear]);
    snapshot = { ...snapshot, annotations: [concurrent] };
    await browserSync(bridge, snapshot, [clear.id]);
    expect(successContent(await clearCall)).toEqual({
      command: clear,
      snapshot,
    });

    expect(client.protocolFailure).toBeUndefined();
    expect(client.stderr).not.toContain(bridge.session.token);
  });
});

interface PendingRequest {
  readonly resolve: (message: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

class McpClient {
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
    this.#process.on('error', () =>
      this.#failPending(new Error('MCP subprocess failed to start')),
    );
    this.#process.on('exit', () =>
      this.#failPending(new Error('MCP subprocess exited before responding')),
    );
  }

  get stderr(): string {
    return this.#stderr;
  }

  get protocolFailure(): Error | undefined {
    return this.#protocolFailure;
  }

  async initialize(): Promise<void> {
    await this.#request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'creasekit-mutation-test', version: '1.0.0' },
    });
    this.#write({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.#request('tools/call', {
      name,
      arguments: arguments_,
    });
    if (!isRecord(response.result)) throw new Error('Tool result was missing');
    return response.result;
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

  #request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 8_000);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
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
      if (typeof input.id !== 'number') continue;
      const pending = this.#pending.get(input.id);
      if (pending === undefined) continue;
      clearTimeout(pending.timeout);
      this.#pending.delete(input.id);
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

const browserSync = async (
  bridge: TestBridge,
  snapshot: AgentSnapshot,
  acknowledgedCommandIds: ReadonlyArray<string> = [],
): Promise<AgentSyncResponse> => {
  const response = await fetch(new URL(BRIDGE_SYNC_PATH, bridge.session.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: bridge.session.url,
    },
    body: JSON.stringify({ snapshot, acknowledgedCommandIds }),
  });
  if (!response.ok) throw new Error(`Browser sync failed (${response.status})`);
  return Schema.decodeUnknownSync(AgentSyncResponse)(await response.json());
};

const waitForCommand = async (
  bridge: TestBridge,
  snapshot: AgentSnapshot,
  type: AgentCommand['type'],
): Promise<AgentCommand> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const command = (await browserSync(bridge, snapshot)).commands[0];
    if (command?.type === type) return command;
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${type} command`);
};

const successContent = (result: Record<string, unknown>): unknown => {
  expect(result.isError).toBe(false);
  return result.structuredContent;
};

const toolText = (result: Record<string, unknown>): string => {
  if (!Array.isArray(result.content)) throw new Error('Tool content was missing');
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== 'string') {
    throw new Error('Tool text was missing');
  }
  return first.text;
};

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input);

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
