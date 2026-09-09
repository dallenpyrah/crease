import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_ANNOTATIONS,
  SnapshotStore,
  createSessionDescriptor,
  decodeSnapshot,
  readSessionFile,
  removeOwnedSessionFile,
  sessionFilePath,
  validateBridgeUrl,
  writeSessionFile,
} from './bridge';
import { annotationFixture, snapshotFixture } from './test-fixtures';

describe('snapshot bridge state', () => {
  it('expires captured handoffs and distinguishes stale from unknown sessions', () => {
    let now = 1_000;
    const store = new SnapshotStore({ ttlMs: 50, now: () => now });
    store.share(snapshotFixture('shared'));

    expect(store.get('shared')._tag).toBe('Found');
    now += 50;
    expect(store.get('shared')._tag).toBe('Stale');
    expect(store.list()).toEqual([]);
    expect(store.get('never-shared')._tag).toBe('NotShared');

    now += 50;
    expect(store.get('shared')._tag).toBe('NotShared');
  });

  it('caps concurrent sessions but permits replacing an existing handoff', () => {
    const store = new SnapshotStore({ maxSessions: 2 });
    expect(store.share(snapshotFixture('one'))).toBe(true);
    expect(store.share(snapshotFixture('two'))).toBe(true);
    expect(store.share(snapshotFixture('three'))).toBe(false);
    expect(
      store.share({ ...snapshotFixture('one'), page: 'http://localhost/new' }),
    ).toBe(true);
    expect(store.list()).toHaveLength(2);
    expect(store.get('one')).toMatchObject({
      _tag: 'Found',
      snapshot: { page: 'http://localhost/new' },
    });
  });

  it('enforces the annotation limit after decoding the shared contract', () => {
    const annotations = Array.from({ length: MAX_ANNOTATIONS + 1 }, (_, index) =>
      annotationFixture(`cr_${index}`),
    );
    expect(() => decodeSnapshot(snapshotFixture('large', annotations))).toThrow(
      `at most ${MAX_ANNOTATIONS}`,
    );
  });
});

describe('protected bridge session files', () => {
  it('writes protected credentials and removes only the owned session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crease-bridge-'));
    try {
      const first = createSessionDescriptor(31_001);
      const firstOwnership = await writeSessionFile(root, first);
      const directoryMode = (await stat(join(root, '.crease'))).mode & 0o777;
      const fileMode = (await stat(sessionFilePath(root))).mode & 0o777;
      expect(directoryMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
      expect((await readSessionFile(root)).url).toBe(first.url);

      const second = createSessionDescriptor(31_002);
      const secondOwnership = await writeSessionFile(root, second);
      await removeOwnedSessionFile(firstOwnership);
      expect((await readSessionFile(root)).url).toBe(second.url);

      await removeOwnedSessionFile(secondOwnership);
      await expect(stat(sessionFilePath(root))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects credential destinations outside an exact HTTP loopback origin', () => {
    expect(() => validateBridgeUrl('https://127.0.0.1:5173')).toThrow();
    expect(() => validateBridgeUrl('http://0.0.0.0:5173')).toThrow();
    expect(() => validateBridgeUrl('http://localhost.evil:5173')).toThrow();
    expect(() => validateBridgeUrl('http://127.0.0.1:5173/path')).toThrow();
    expect(validateBridgeUrl('http://[::1]:5173').hostname).toContain('::1');
  });
});
