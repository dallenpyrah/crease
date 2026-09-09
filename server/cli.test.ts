import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import metadata from '../package.json' with { type: 'json' };
import { BRIDGE_SHARE_PATH } from './bridge';
import { type TestBridge, snapshotFixture, startTestBridge } from './test-fixtures';

describe('creasekit CLI', () => {
  let bridge: TestBridge | undefined;
  let roots: Array<string> = [];
  let clients: Array<McpWireClient> = [];

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    clients = [];
    if (bridge !== undefined) await bridge.server.close();
    bridge = undefined;
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots = [];
  });

  it('prints setup help without starting the MCP server', async () => {
    for (const argument of ['--help', '-h']) {
      const result = await runCli([argument]);
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Usage: creasekit [--cwd <project-directory>]');
      expect(result.stdout).toContain('creasekit MCP server');
      expect(result.stdout).toContain('Setup:');
    }
  });

  it('rejects invalid arguments before MCP startup', async () => {
    const cases = [
      { arguments_: ['--cwd'], message: '--cwd requires a project directory' },
      { arguments_: ['--unsupported'], message: 'Unsupported argument' },
      {
        arguments_: ['--cwd', 'first', '--cwd', 'second'],
        message: '--cwd may only be provided once',
      },
    ];

    for (const { arguments_, message } of cases) {
      const result = await runCli(arguments_);
      expect(result.exitCode).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`creasekit: ${message}`);
      expect(result.stderr).toContain('Use "creasekit --help" for usage.');
    }
  });

  it('uses an absolute or relative project directory before starting MCP', async () => {
    const project = await createRoot('creasekit-cli-project-');
    const launcher = await createRoot('creasekit-cli-launcher-');
    bridge = await startTestBridge(project);
    const snapshot = snapshotFixture();
    expect((await share(bridge, snapshot)).status).toBe(204);

    for (const directory of [project, relative(launcher, project)]) {
      const client = new McpWireClient(['--cwd', directory], launcher);
      clients.push(client);

      expect(
        await client.request('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'creasekit-cli-test', version: '1.0.0' },
        }),
      ).toMatchObject({
        result: { serverInfo: { name: 'creasekit', version: metadata.version } },
      });
      client.notify('notifications/initialized', {});

      expect(
        await client.request('tools/call', {
          name: 'creasekit_list_sessions',
          arguments: {},
        }),
      ).toMatchObject({
        result: {
          structuredContent: {
            sessions: [
              {
                runtimeId: snapshot.runtimeId,
                projectId: snapshot.projectId,
                page: snapshot.page,
                sharedAt: snapshot.sharedAt,
              },
            ],
          },
        },
      });
      expect(client.protocolFailure).toBeUndefined();
      expect(client.stderr).not.toContain(bridge.session.token);
    }
  });

  const createRoot = async (prefix: string): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  };
});

interface CliResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

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

  constructor(arguments_: ReadonlyArray<string>, cwd: string) {
    this.#process = spawnCli(arguments_, cwd);
    this.#process.stdout.setEncoding('utf8');
    this.#process.stderr.setEncoding('utf8');
    this.#process.stdout.on('data', (chunk: string) => this.#readStdout(chunk));
    this.#process.stderr.on('data', (chunk: string) => {
      if (this.#stderr.length < 1024 * 1024) this.#stderr += chunk;
    });
    this.#process.on('error', () => {
      this.#failPending(new Error('CLI subprocess failed to start'));
    });
    this.#process.on('exit', () => {
      this.#failPending(new Error('CLI subprocess exited before responding'));
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

const runCli = (
  arguments_: ReadonlyArray<string>,
  cwd?: string,
): Promise<CliResult> => {
  const process = spawnCli(arguments_, cwd);
  process.stdout.setEncoding('utf8');
  process.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error('CLI did not exit after handling its arguments'));
    }, 5_000);
    process.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    process.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    process.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
};

const spawnCli = (
  arguments_: ReadonlyArray<string>,
  cwd?: string,
): ChildProcessWithoutNullStreams => {
  const tsx = fileURLToPath(
    new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url),
  );
  const entry = fileURLToPath(new URL('./cli.ts', import.meta.url));
  return spawn(process.execPath, [tsx, entry, ...arguments_], {
    ...(cwd === undefined ? {} : { cwd }),
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: 'pipe',
  });
};

const share = (bridge: TestBridge, snapshot: unknown): Promise<Response> =>
  fetch(new URL(BRIDGE_SHARE_PATH, bridge.session.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: bridge.session.url,
    },
    body: JSON.stringify(snapshot),
  });

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input);

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
