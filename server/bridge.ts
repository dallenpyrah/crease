import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';

import { Schema } from 'effect';

import {
  AGENT_COMMAND_TIMEOUT_MS,
  AgentCommand,
  type AgentCommand as AgentCommandValue,
  AgentSnapshot,
  type AgentSnapshot as AgentSnapshotValue,
  AgentSyncRequest,
  type AgentSyncRequest as AgentSyncRequestValue,
  type AgentSyncResponse as AgentSyncResponseValue,
} from '../src/agent-contract.js';

export const BRIDGE_SHARE_PATH = '/__creasekit/share';
export const BRIDGE_UNSHARE_PATH = '/__creasekit/unshare';
export const BRIDGE_CONTEXT_PATH = '/__creasekit/context';
export const BRIDGE_SYNC_PATH = '/__creasekit/sync';
export const BRIDGE_COMMANDS_PATH = '/__creasekit/commands';
export const BRIDGE_WATCH_PATH = '/__creasekit/watch';
export const MAX_REQUEST_BODY_BYTES = 128 * 1024;
export const MAX_ANNOTATIONS = 100;
export const MAX_SESSIONS = 20;
export const MAX_PENDING_COMMANDS = 100;
export const MAX_ACKNOWLEDGED_COMMAND_IDS = 200;
export const MAX_COMMAND_WATCHERS = 1;
export const COMMAND_WATCH_HEARTBEAT_MS = 15_000;
export const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const SESSION_DIRECTORY = '.creasekit';
export const SESSION_FILENAME = 'mcp-session.json';

const SESSION_FILE_MAX_BYTES = 4 * 1024;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const UnshareRequest = Schema.Struct({ runtimeId: Schema.String });
export type UnshareRequest = typeof UnshareRequest.Type;

export const WatchRequest = Schema.Struct({ runtimeId: Schema.String });
export type WatchRequest = typeof WatchRequest.Type;

const DeleteCommandRequest = Schema.Struct({
  runtimeId: Schema.String,
  type: Schema.Literal('delete'),
  annotationId: Schema.String,
});

const ClearCommandRequest = Schema.Struct({
  runtimeId: Schema.String,
  type: Schema.Literal('clear'),
});

export const BridgeCommandRequest = Schema.Union([
  DeleteCommandRequest,
  ClearCommandRequest,
]);
export type BridgeCommandRequest = typeof BridgeCommandRequest.Type;

export const BridgeCommandResponse = Schema.Struct({
  command: AgentCommand,
  snapshot: AgentSnapshot,
});
export type BridgeCommandResponse = typeof BridgeCommandResponse.Type;

const SessionDescriptorSchema = Schema.Struct({
  url: Schema.String,
  token: Schema.String,
});

export interface SessionDescriptor {
  readonly url: string;
  readonly token: string;
}

export interface OwnedSessionFile {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

interface StoredSnapshot {
  snapshot: AgentSnapshotValue;
  expiresAt: number;
  readonly pendingCommands: Map<string, PendingCommand>;
  readonly commandWatchers: Map<number, PendingCommandWatcher>;
}

interface PendingCommand {
  readonly command: AgentCommandValue;
  readonly expiresAt: number;
  readonly completion: Promise<BridgeCommandResponse>;
  readonly resolve: (result: BridgeCommandResponse) => void;
  readonly reject: (error: CommandQueueError) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface PendingCommandWatcher {
  readonly resolve: () => void;
  readonly reject: (error: CommandQueueError) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export type SnapshotLookup =
  | { readonly _tag: 'Found'; readonly snapshot: AgentSnapshotValue }
  | { readonly _tag: 'Stale' }
  | { readonly _tag: 'NotShared' };

export type CommandQueueFailure =
  | 'SnapshotStale'
  | 'NotShared'
  | 'AnnotationNotFound'
  | 'QueueFull'
  | 'WatchLimit'
  | 'InvalidCommand'
  | 'DuplicateCommandId'
  | 'NotApplied'
  | 'Expired'
  | 'Cancelled';

export class CommandQueueError extends Error {
  readonly name = 'CommandQueueError';

  constructor(readonly reason: CommandQueueFailure) {
    super(reason);
  }
}

export interface QueuedAgentCommand {
  readonly command: AgentCommandValue;
  readonly completion: Promise<BridgeCommandResponse>;
  readonly cancel: () => boolean;
}

export interface AgentCommandWatch {
  readonly completion: Promise<void>;
  readonly cancel: () => boolean;
}

export class SnapshotStore {
  readonly #snapshots = new Map<string, StoredSnapshot>();
  readonly #expired = new Map<string, number>();
  readonly #retiredCommandIds = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #maxSessions: number;
  readonly #commandTimeoutMs: number;
  readonly #maxPendingCommands: number;
  readonly #now: () => number;
  readonly #createCommandId: () => string;
  #nextWatcherId = 1;

  constructor(options?: {
    readonly ttlMs?: number;
    readonly maxSessions?: number;
    readonly commandTimeoutMs?: number;
    readonly maxPendingCommands?: number;
    readonly now?: () => number;
    readonly createCommandId?: () => string;
  }) {
    this.#ttlMs = options?.ttlMs ?? SNAPSHOT_TTL_MS;
    this.#maxSessions = options?.maxSessions ?? MAX_SESSIONS;
    this.#commandTimeoutMs = options?.commandTimeoutMs ?? AGENT_COMMAND_TIMEOUT_MS;
    this.#maxPendingCommands = options?.maxPendingCommands ?? MAX_PENDING_COMMANDS;
    this.#now = options?.now ?? Date.now;
    this.#createCommandId = options?.createCommandId ?? randomUUID;

    if (!Number.isFinite(this.#ttlMs) || this.#ttlMs <= 0) {
      throw new Error('Snapshot TTL must be a positive finite number');
    }
    if (!Number.isInteger(this.#maxSessions) || this.#maxSessions <= 0) {
      throw new Error('Snapshot session limit must be a positive integer');
    }
    if (!Number.isFinite(this.#commandTimeoutMs) || this.#commandTimeoutMs <= 0) {
      throw new Error('Command timeout must be a positive finite number');
    }
    if (!Number.isInteger(this.#maxPendingCommands) || this.#maxPendingCommands <= 0) {
      throw new Error('Pending command limit must be a positive integer');
    }
  }

  share(snapshot: AgentSnapshotValue): boolean {
    const now = this.#now();
    this.#prune(now);
    if (
      !this.#snapshots.has(snapshot.runtimeId) &&
      this.#snapshots.size >= this.#maxSessions
    ) {
      return false;
    }

    const stored = this.#snapshots.get(snapshot.runtimeId);
    if (stored === undefined) {
      this.#snapshots.set(snapshot.runtimeId, {
        snapshot,
        expiresAt: now + this.#ttlMs,
        pendingCommands: new Map(),
        commandWatchers: new Map(),
      });
    } else {
      stored.snapshot = snapshot;
      stored.expiresAt = now + this.#ttlMs;
    }
    this.#expired.delete(snapshot.runtimeId);
    return true;
  }

  sync(request: AgentSyncRequestValue): AgentSyncResponseValue | undefined {
    const now = this.#now();
    this.#prune(now);
    let stored = this.#snapshots.get(request.snapshot.runtimeId);
    if (stored === undefined) {
      if (this.#snapshots.size >= this.#maxSessions) return undefined;
      stored = {
        snapshot: request.snapshot,
        expiresAt: now + this.#ttlMs,
        pendingCommands: new Map(),
        commandWatchers: new Map(),
      };
      this.#snapshots.set(request.snapshot.runtimeId, stored);
    } else {
      stored.snapshot = request.snapshot;
      stored.expiresAt = now + this.#ttlMs;
    }
    this.#expired.delete(request.snapshot.runtimeId);

    for (const commandId of request.acknowledgedCommandIds) {
      const pending = stored.pendingCommands.get(commandId);
      if (pending === undefined) continue;
      if (!commandIsReflected(pending.command, request.snapshot)) {
        this.#settleCommand(
          request.snapshot.runtimeId,
          commandId,
          new CommandQueueError('NotApplied'),
        );
        continue;
      }
      this.#settleCommand(request.snapshot.runtimeId, commandId, {
        command: pending.command,
        snapshot: request.snapshot,
      });
    }

    return {
      commands: Array.from(stored.pendingCommands.values(), ({ command }) => command),
    };
  }

  watch(runtimeId: string): AgentCommandWatch {
    const now = this.#now();
    this.#prune(now);
    const stored = this.#snapshots.get(runtimeId);
    if (stored === undefined) {
      throw new CommandQueueError(
        this.#expired.has(runtimeId) ? 'SnapshotStale' : 'NotShared',
      );
    }
    if (stored.pendingCommands.size > 0) {
      return { completion: Promise.resolve(), cancel: () => false };
    }
    if (stored.commandWatchers.size >= MAX_COMMAND_WATCHERS) {
      throw new CommandQueueError('WatchLimit');
    }

    const watcherId = this.#nextWatcherId;
    this.#nextWatcherId += 1;
    let resolve!: () => void;
    let reject!: (error: CommandQueueError) => void;
    const completion = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timeout = setTimeout(() => {
      this.#settleWatcher(runtimeId, watcherId);
    }, COMMAND_WATCH_HEARTBEAT_MS);
    timeout.unref?.();
    stored.commandWatchers.set(watcherId, { resolve, reject, timeout });
    return {
      completion,
      cancel: () =>
        this.#settleWatcher(runtimeId, watcherId, new CommandQueueError('Cancelled')),
    };
  }

  queueCommand(request: BridgeCommandRequest): QueuedAgentCommand {
    const now = this.#now();
    this.#prune(now);
    const stored = this.#snapshots.get(request.runtimeId);
    if (stored === undefined) {
      throw new CommandQueueError(
        this.#expired.has(request.runtimeId) ? 'SnapshotStale' : 'NotShared',
      );
    }
    if (stored.pendingCommands.size >= this.#maxPendingCommands) {
      throw new CommandQueueError('QueueFull');
    }
    if (
      request.type === 'delete' &&
      !stored.snapshot.annotations.some(({ id }) => id === request.annotationId)
    ) {
      throw new CommandQueueError('AnnotationNotFound');
    }

    const id = this.#createCommandId();
    if (id.length === 0 || this.#hasCommandId(id)) {
      throw new CommandQueueError('DuplicateCommandId');
    }
    const command: AgentCommandValue =
      request.type === 'delete'
        ? {
            id,
            type: 'delete',
            annotationId: request.annotationId,
            createdAt: now,
          }
        : {
            id,
            type: 'clear',
            annotationIds: stored.snapshot.annotations.map(({ id }) => id),
            createdAt: now,
          };

    let resolve!: (result: BridgeCommandResponse) => void;
    let reject!: (error: CommandQueueError) => void;
    const completion = new Promise<BridgeCommandResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timeout = setTimeout(() => {
      this.#settleCommand(
        request.runtimeId,
        command.id,
        new CommandQueueError('Expired'),
      );
    }, this.#commandTimeoutMs);
    timeout.unref?.();
    stored.pendingCommands.set(command.id, {
      command,
      expiresAt: now + this.#commandTimeoutMs,
      completion,
      resolve,
      reject,
      timeout,
    });
    for (const watcherId of [...stored.commandWatchers.keys()]) {
      this.#settleWatcher(request.runtimeId, watcherId);
    }

    return {
      command,
      completion,
      cancel: () =>
        this.#settleCommand(
          request.runtimeId,
          command.id,
          new CommandQueueError('Cancelled'),
        ),
    };
  }

  unshare(runtimeId: string): boolean {
    this.#prune(this.#now());
    this.#expired.delete(runtimeId);
    return this.#removeSession(runtimeId, new CommandQueueError('Cancelled'));
  }

  list(): ReadonlyArray<AgentSnapshotValue> {
    this.#prune(this.#now());
    return Array.from(this.#snapshots.values(), ({ snapshot }) => snapshot);
  }

  get(runtimeId: string): SnapshotLookup {
    this.#prune(this.#now());
    const stored = this.#snapshots.get(runtimeId);
    if (stored !== undefined) {
      return { _tag: 'Found', snapshot: stored.snapshot };
    }
    return this.#expired.has(runtimeId) ? { _tag: 'Stale' } : { _tag: 'NotShared' };
  }

  clear(): void {
    for (const runtimeId of [...this.#snapshots.keys()]) {
      this.#removeSession(runtimeId, new CommandQueueError('Cancelled'));
    }
    this.#expired.clear();
    this.#retiredCommandIds.clear();
  }

  #prune(now: number): void {
    for (const [runtimeId, stored] of this.#snapshots) {
      if (stored.expiresAt <= now) {
        this.#removeSession(runtimeId, new CommandQueueError('Expired'));
        this.#expired.set(runtimeId, now + this.#ttlMs);
        continue;
      }
      for (const [commandId, pending] of stored.pendingCommands) {
        if (pending.expiresAt <= now) {
          this.#settleCommand(runtimeId, commandId, new CommandQueueError('Expired'));
        }
      }
    }
    for (const [runtimeId, forgetAt] of this.#expired) {
      if (forgetAt <= now) this.#expired.delete(runtimeId);
    }
    for (const [commandId, forgetAt] of this.#retiredCommandIds) {
      if (forgetAt <= now) this.#retiredCommandIds.delete(commandId);
    }
  }

  #hasCommandId(id: string): boolean {
    if (this.#retiredCommandIds.has(id)) return true;
    for (const stored of this.#snapshots.values()) {
      if (stored.pendingCommands.has(id)) return true;
      if (stored.snapshot.annotations.some((annotation) => annotation.id === id)) {
        return true;
      }
    }
    return false;
  }

  #removeSession(runtimeId: string, error: CommandQueueError): boolean {
    const stored = this.#snapshots.get(runtimeId);
    if (stored === undefined) return false;
    for (const commandId of [...stored.pendingCommands.keys()]) {
      this.#settleCommand(runtimeId, commandId, error);
    }
    for (const watcherId of [...stored.commandWatchers.keys()]) {
      this.#settleWatcher(runtimeId, watcherId, error);
    }
    this.#snapshots.delete(runtimeId);
    return true;
  }

  #settleWatcher(
    runtimeId: string,
    watcherId: number,
    error?: CommandQueueError,
  ): boolean {
    const stored = this.#snapshots.get(runtimeId);
    if (stored === undefined) return false;
    const watcher = stored.commandWatchers.get(watcherId);
    if (watcher === undefined) return false;
    stored.commandWatchers.delete(watcherId);
    clearTimeout(watcher.timeout);
    if (error === undefined) watcher.resolve();
    else watcher.reject(error);
    return true;
  }

  #settleCommand(
    runtimeId: string,
    commandId: string,
    outcome: BridgeCommandResponse | CommandQueueError,
  ): boolean {
    const stored = this.#snapshots.get(runtimeId);
    if (stored === undefined) return false;
    const pending = stored.pendingCommands.get(commandId);
    if (pending === undefined) return false;
    stored.pendingCommands.delete(commandId);
    clearTimeout(pending.timeout);
    this.#retiredCommandIds.set(commandId, this.#now() + this.#ttlMs);
    while (
      this.#retiredCommandIds.size >
      this.#maxSessions * this.#maxPendingCommands
    ) {
      const oldest = this.#retiredCommandIds.keys().next();
      if (oldest.done) break;
      this.#retiredCommandIds.delete(oldest.value);
    }
    if (outcome instanceof CommandQueueError) pending.reject(outcome);
    else pending.resolve(outcome);
    return true;
  }
}

const commandIsReflected = (
  command: AgentCommandValue,
  snapshot: AgentSnapshotValue,
): boolean => {
  if (command.type === 'delete') {
    return !snapshot.annotations.some(({ id }) => id === command.annotationId);
  }
  const remainingIds = new Set(snapshot.annotations.map(({ id }) => id));
  return command.annotationIds.every((id) => !remainingIds.has(id));
};

const validateDecodedSnapshot = (snapshot: AgentSnapshotValue): AgentSnapshotValue => {
  if (snapshot.annotations.length > MAX_ANNOTATIONS) {
    throw new Error(`A snapshot may contain at most ${MAX_ANNOTATIONS} annotations`);
  }
  const annotationIds = new Set<string>();
  for (const annotation of snapshot.annotations) {
    if (annotationIds.has(annotation.id)) {
      throw new Error('A snapshot may not contain duplicate annotation IDs');
    }
    annotationIds.add(annotation.id);
  }
  return snapshot;
};

export const decodeSnapshot = (input: unknown): AgentSnapshotValue => {
  return validateDecodedSnapshot(Schema.decodeUnknownSync(AgentSnapshot)(input));
};

export const decodeSyncRequest = (input: unknown): AgentSyncRequestValue => {
  const request = Schema.decodeUnknownSync(AgentSyncRequest)(input);
  validateDecodedSnapshot(request.snapshot);
  if (request.acknowledgedCommandIds.length > MAX_ACKNOWLEDGED_COMMAND_IDS) {
    throw new Error(
      `A sync may acknowledge at most ${MAX_ACKNOWLEDGED_COMMAND_IDS} commands`,
    );
  }
  if (
    new Set(request.acknowledgedCommandIds).size !==
    request.acknowledgedCommandIds.length
  ) {
    throw new Error('A sync may not contain duplicate command IDs');
  }
  return request;
};

export const decodeBridgeCommandResponse = (input: unknown): BridgeCommandResponse => {
  const result = Schema.decodeUnknownSync(BridgeCommandResponse)(input);
  validateDecodedSnapshot(result.snapshot);
  if (
    result.command.id.length === 0 ||
    !commandIsReflected(result.command, result.snapshot)
  ) {
    throw new Error('The bridge command is not reflected in its snapshot');
  }
  if (
    result.command.type === 'clear' &&
    (result.command.annotationIds.length > MAX_ANNOTATIONS ||
      new Set(result.command.annotationIds).size !==
        result.command.annotationIds.length)
  ) {
    throw new Error('The bridge returned an invalid clear command scope');
  }
  return result;
};

export const decodeSnapshotList = (
  input: unknown,
): ReadonlyArray<AgentSnapshotValue> => {
  const snapshots = Schema.decodeUnknownSync(Schema.Array(AgentSnapshot))(input);
  if (snapshots.length > MAX_SESSIONS) {
    throw new Error(`A bridge may expose at most ${MAX_SESSIONS} sessions`);
  }
  for (const snapshot of snapshots) validateDecodedSnapshot(snapshot);
  return snapshots;
};

export const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
  );
};

export const isLoopbackAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1'
  );
};

export const validateBridgeUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Bridge session URL is invalid');
  }

  if (
    url.protocol !== 'http:' ||
    !isLoopbackHostname(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.port === ''
  ) {
    throw new Error('Bridge session URL must be an HTTP loopback origin');
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Bridge session URL has an invalid port');
  }
  return url;
};

export const createSessionDescriptor = (
  port: number,
  address = '127.0.0.1',
): SessionDescriptor => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Cannot create a bridge session with an invalid port');
  }
  if (!isLoopbackAddress(address)) {
    throw new Error('Cannot create a bridge session for a non-loopback address');
  }

  const host = address === '::1' ? '[::1]' : '127.0.0.1';
  return {
    url: `http://${host}:${port}`,
    token: randomBytes(32).toString('hex'),
  };
};

export const sessionFilePath = (projectRoot: string): string =>
  join(projectRoot, SESSION_DIRECTORY, SESSION_FILENAME);

export const writeSessionFile = async (
  projectRoot: string,
  descriptor: SessionDescriptor,
): Promise<OwnedSessionFile> => {
  validateSessionDescriptor(descriptor);
  const directory = join(projectRoot, SESSION_DIRECTORY);
  const path = sessionFilePath(projectRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('creasekit session directory is not a regular directory');
  }
  await chmod(directory, 0o700);

  const temporaryPath = join(
    directory,
    `.mcp-session-${process.pid}-${randomBytes(8).toString('hex')}.tmp`,
  );
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(descriptor), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await chmod(path, 0o600);
  const fileStat = await stat(path);
  return { path, device: fileStat.dev, inode: fileStat.ino };
};

export const removeOwnedSessionFile = async (
  owned: OwnedSessionFile,
): Promise<void> => {
  let current;
  try {
    current = await lstat(owned.path);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return;
    throw error;
  }

  if (
    current.isFile() &&
    !current.isSymbolicLink() &&
    current.dev === owned.device &&
    current.ino === owned.inode
  ) {
    await unlink(owned.path);
  }
};

export type SessionReadFailure = 'Offline' | 'Invalid';

export class SessionReadError extends Error {
  readonly name = 'SessionReadError';

  constructor(
    readonly reason: SessionReadFailure,
    message: string,
  ) {
    super(message);
  }
}

export const readSessionFile = async (
  projectRoot: string,
): Promise<SessionDescriptor> => {
  const path = sessionFilePath(projectRoot);
  let encoded: Buffer;
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile() || fileStat.size > SESSION_FILE_MAX_BYTES) {
      throw new SessionReadError(
        'Invalid',
        'creasekit bridge session configuration is invalid or stale',
      );
    }
    encoded = await readFile(path);
  } catch (error) {
    if (error instanceof SessionReadError) throw error;
    if (isNodeError(error, 'ENOENT')) {
      throw new SessionReadError(
        'Offline',
        'creasekit bridge is offline; start the Vite development server to sync browser feedback',
      );
    }
    throw new SessionReadError(
      'Invalid',
      'creasekit bridge session configuration could not be read',
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded));
  } catch {
    throw new SessionReadError(
      'Invalid',
      'creasekit bridge session configuration is invalid or stale',
    );
  }

  try {
    const descriptor = Schema.decodeUnknownSync(SessionDescriptorSchema)(input);
    validateSessionDescriptor(descriptor);
    return descriptor;
  } catch {
    throw new SessionReadError(
      'Invalid',
      'creasekit bridge session configuration is invalid or stale',
    );
  }
};

export const constantTimeTokenEqual = (received: string, expected: string): boolean => {
  const receivedDigest = createHash('sha256').update(received).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
};

const validateSessionDescriptor = (
  descriptor: SessionDescriptor,
): SessionDescriptor => {
  validateBridgeUrl(descriptor.url);
  if (!TOKEN_PATTERN.test(descriptor.token)) {
    throw new Error('Bridge session token is invalid');
  }
  return descriptor;
};

const isNodeError = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;
