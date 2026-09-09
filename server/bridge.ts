import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
  AgentSnapshot,
  type AgentSnapshot as AgentSnapshotValue,
} from '../src/agent-contract.js';

export const BRIDGE_SHARE_PATH = '/__creasekit/share';
export const BRIDGE_UNSHARE_PATH = '/__creasekit/unshare';
export const BRIDGE_CONTEXT_PATH = '/__creasekit/context';
export const MAX_REQUEST_BODY_BYTES = 128 * 1024;
export const MAX_ANNOTATIONS = 100;
export const MAX_SESSIONS = 20;
export const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const SESSION_DIRECTORY = '.creasekit';
export const SESSION_FILENAME = 'mcp-session.json';

const SESSION_FILE_MAX_BYTES = 4 * 1024;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const UnshareRequest = Schema.Struct({ runtimeId: Schema.String });
export type UnshareRequest = typeof UnshareRequest.Type;

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
  readonly snapshot: AgentSnapshotValue;
  readonly expiresAt: number;
}

export type SnapshotLookup =
  | { readonly _tag: 'Found'; readonly snapshot: AgentSnapshotValue }
  | { readonly _tag: 'Stale' }
  | { readonly _tag: 'NotShared' };

export class SnapshotStore {
  readonly #snapshots = new Map<string, StoredSnapshot>();
  readonly #expired = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #maxSessions: number;
  readonly #now: () => number;

  constructor(options?: {
    readonly ttlMs?: number;
    readonly maxSessions?: number;
    readonly now?: () => number;
  }) {
    this.#ttlMs = options?.ttlMs ?? SNAPSHOT_TTL_MS;
    this.#maxSessions = options?.maxSessions ?? MAX_SESSIONS;
    this.#now = options?.now ?? Date.now;

    if (!Number.isFinite(this.#ttlMs) || this.#ttlMs <= 0) {
      throw new Error('Snapshot TTL must be a positive finite number');
    }
    if (!Number.isInteger(this.#maxSessions) || this.#maxSessions <= 0) {
      throw new Error('Snapshot session limit must be a positive integer');
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

    this.#snapshots.set(snapshot.runtimeId, {
      snapshot,
      expiresAt: now + this.#ttlMs,
    });
    this.#expired.delete(snapshot.runtimeId);
    return true;
  }

  unshare(runtimeId: string): boolean {
    this.#prune(this.#now());
    this.#expired.delete(runtimeId);
    return this.#snapshots.delete(runtimeId);
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
    this.#snapshots.clear();
    this.#expired.clear();
  }

  #prune(now: number): void {
    for (const [runtimeId, stored] of this.#snapshots) {
      if (stored.expiresAt <= now) {
        this.#snapshots.delete(runtimeId);
        this.#expired.set(runtimeId, now + this.#ttlMs);
      }
    }
    for (const [runtimeId, forgetAt] of this.#expired) {
      if (forgetAt <= now) this.#expired.delete(runtimeId);
    }
  }
}

export const decodeSnapshot = (input: unknown): AgentSnapshotValue => {
  const snapshot = Schema.decodeUnknownSync(AgentSnapshot)(input);
  if (snapshot.annotations.length > MAX_ANNOTATIONS) {
    throw new Error(`A snapshot may contain at most ${MAX_ANNOTATIONS} annotations`);
  }
  return snapshot;
};

export const decodeSnapshotList = (
  input: unknown,
): ReadonlyArray<AgentSnapshotValue> => {
  const snapshots = Schema.decodeUnknownSync(Schema.Array(AgentSnapshot))(input);
  if (snapshots.length > MAX_SESSIONS) {
    throw new Error(`A bridge may expose at most ${MAX_SESSIONS} sessions`);
  }
  for (const snapshot of snapshots) {
    if (snapshot.annotations.length > MAX_ANNOTATIONS) {
      throw new Error(`A snapshot may contain at most ${MAX_ANNOTATIONS} annotations`);
    }
  }
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
        'creasekit bridge is offline; start the Vite development server and share context',
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
