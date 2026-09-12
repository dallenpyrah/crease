import { describe, expect, it } from 'vitest';

import {
  CommandQueueError,
  SnapshotStore,
  decodeBridgeCommandResponse,
  decodeSyncRequest,
} from './bridge';
import { annotationFixture, snapshotFixture } from './test-fixtures';

describe('automatic agent sync state', () => {
  it('ingests a live snapshot on the first sync without an explicit share', () => {
    const store = new SnapshotStore();
    const snapshot = snapshotFixture('automatic');

    expect(store.sync({ snapshot, acknowledgedCommandIds: [] })).toEqual({
      commands: [],
    });
    expect(store.get('automatic')).toEqual({ _tag: 'Found', snapshot });
  });

  it('redelivers commands until an acknowledgement atomically updates the snapshot', async () => {
    const store = new SnapshotStore({ createCommandId: () => 'command-delete' });
    const snapshot = snapshotFixture('delivery');
    store.sync({ snapshot, acknowledgedCommandIds: [] });
    const queued = store.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'delete',
      annotationId: snapshot.annotations[0]?.id ?? '',
    });

    expect(store.sync({ snapshot, acknowledgedCommandIds: [] })?.commands).toEqual([
      queued.command,
    ]);
    expect(store.sync({ snapshot, acknowledgedCommandIds: [] })?.commands).toEqual([
      queued.command,
    ]);

    const appliedSnapshot = { ...snapshot, annotations: [] };
    expect(
      store.sync({
        snapshot: appliedSnapshot,
        acknowledgedCommandIds: [queued.command.id],
      }),
    ).toEqual({ commands: [] });
    await expect(queued.completion).resolves.toEqual({
      command: queued.command,
      snapshot: appliedSnapshot,
    });
    expect(store.get(snapshot.runtimeId)).toEqual({
      _tag: 'Found',
      snapshot: appliedSnapshot,
    });
  });

  it('only completes a delete when the acknowledgement removes its target', async () => {
    const store = new SnapshotStore({ createCommandId: () => 'command-delete-target' });
    const deleted = annotationFixture('deleted');
    const remaining = annotationFixture('remaining');
    const snapshot = snapshotFixture('delete-reflection', [deleted, remaining]);
    store.sync({ snapshot, acknowledgedCommandIds: [] });
    const queued = store.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'delete',
      annotationId: deleted.id,
    });
    const command = queued.command;
    if (command.type !== 'delete') throw new Error('Expected a delete command');
    const appliedSnapshot = {
      ...snapshot,
      annotations: [remaining],
    };

    store.sync({
      snapshot: appliedSnapshot,
      acknowledgedCommandIds: [command.id],
    });
    await expect(queued.completion).resolves.toEqual({
      command,
      snapshot: appliedSnapshot,
    });
  });

  it('fails rather than claiming a clear applied while a queued annotation remains', async () => {
    const store = new SnapshotStore({ createCommandId: () => 'incomplete-clear' });
    const first = annotationFixture('first');
    const remaining = annotationFixture('remaining');
    const snapshot = snapshotFixture('clear-race', [first, remaining]);
    store.sync({ snapshot, acknowledgedCommandIds: [] });
    const queued = store.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    const completion = queued.completion.catch((error: unknown) => error);

    expect(
      store.sync({
        snapshot: { ...snapshot, annotations: [remaining] },
        acknowledgedCommandIds: [queued.command.id],
      }),
    ).toEqual({ commands: [] });
    await expect(completion).resolves.toMatchObject({
      reason: 'NotApplied',
    });
  });

  it('captures clear scope at enqueue time and preserves concurrent additions', async () => {
    const store = new SnapshotStore({ createCommandId: () => 'scoped-clear' });
    const first = annotationFixture('first');
    const second = annotationFixture('second');
    const concurrent = annotationFixture('concurrent');
    const snapshot = snapshotFixture('clear-scope', [first, second]);
    store.sync({ snapshot, acknowledgedCommandIds: [] });
    const queued = store.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });

    expect(queued.command).toMatchObject({
      type: 'clear',
      annotationIds: ['first', 'second'],
    });
    const concurrentSnapshot = {
      ...snapshot,
      annotations: [first, second, concurrent],
    };
    expect(
      store.sync({ snapshot: concurrentSnapshot, acknowledgedCommandIds: [] })
        ?.commands,
    ).toEqual([queued.command]);

    const appliedSnapshot = { ...snapshot, annotations: [concurrent] };
    store.sync({
      snapshot: appliedSnapshot,
      acknowledgedCommandIds: [queued.command.id],
    });
    await expect(queued.completion).resolves.toEqual({
      command: queued.command,
      snapshot: appliedSnapshot,
    });
  });

  it('bounds queues and rejects duplicate generated or acknowledged IDs', async () => {
    const ids = ['first-command', 'first-command'];
    const store = new SnapshotStore({
      maxPendingCommands: 1,
      createCommandId: () => ids.shift() ?? 'first-command',
    });
    const snapshot = snapshotFixture('limits');
    store.sync({ snapshot, acknowledgedCommandIds: [] });
    const queued = store.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    const completion = queued.completion.catch((error: unknown) => error);

    expect(() =>
      store.queueCommand({ runtimeId: snapshot.runtimeId, type: 'clear' }),
    ).toThrowError(CommandQueueError);
    expect(() =>
      decodeSyncRequest({
        snapshot,
        acknowledgedCommandIds: ['duplicate', 'duplicate'],
      }),
    ).toThrow('duplicate command IDs');

    store.clear();
    await expect(completion).resolves.toMatchObject({ reason: 'Cancelled' });

    const duplicateStore = new SnapshotStore({
      createCommandId: () => 'retired-command',
    });
    duplicateStore.sync({ snapshot, acknowledgedCommandIds: [] });
    const firstCommand = duplicateStore.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    const firstCompletion = firstCommand.completion.catch((error: unknown) => error);
    firstCommand.cancel();
    await firstCompletion;
    expect(() =>
      duplicateStore.queueCommand({
        runtimeId: snapshot.runtimeId,
        type: 'clear',
      }),
    ).toThrowError(CommandQueueError);
  });

  it('removes expired, unshared, and cleared commands before later delivery', async () => {
    const expiringStore = new SnapshotStore({
      commandTimeoutMs: 15,
      createCommandId: () => 'expired-command',
    });
    const snapshot = snapshotFixture('expiry');
    expiringStore.sync({ snapshot, acknowledgedCommandIds: [] });
    const expired = expiringStore.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    await expect(expired.completion).rejects.toMatchObject({ reason: 'Expired' });
    expect(expiringStore.sync({ snapshot, acknowledgedCommandIds: [] })).toEqual({
      commands: [],
    });

    const cancellingStore = new SnapshotStore({
      createCommandId: () => 'cancelled-command',
    });
    cancellingStore.sync({ snapshot, acknowledgedCommandIds: [] });
    const cancelled = cancellingStore.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    const cancellation = cancelled.completion.catch((error: unknown) => error);
    expect(cancellingStore.unshare(snapshot.runtimeId)).toBe(true);
    await expect(cancellation).resolves.toMatchObject({ reason: 'Cancelled' });
    expect(cancellingStore.sync({ snapshot, acknowledgedCommandIds: [] })).toEqual({
      commands: [],
    });
  });

  it('wakes one bounded long poll on enqueue and cleans cancelled watchers', async () => {
    const store = new SnapshotStore({ createCommandId: () => 'watched-command' });
    const snapshot = snapshotFixture('watch');
    store.sync({ snapshot, acknowledgedCommandIds: [] });
    const firstWatch = store.watch(snapshot.runtimeId);
    const firstCompletion = firstWatch.completion.catch((error: unknown) => error);
    expect(() => store.watch(snapshot.runtimeId)).toThrowError(CommandQueueError);
    expect(firstWatch.cancel()).toBe(true);
    await expect(firstCompletion).resolves.toMatchObject({ reason: 'Cancelled' });

    const nextWatch = store.watch(snapshot.runtimeId);
    const command = store.queueCommand({
      runtimeId: snapshot.runtimeId,
      type: 'clear',
    });
    await expect(nextWatch.completion).resolves.toBeUndefined();
    command.cancel();
    await expect(command.completion).rejects.toMatchObject({ reason: 'Cancelled' });
  });

  it('rejects a success response whose snapshot does not reflect its command', () => {
    const snapshot = snapshotFixture('invalid-success');
    expect(() =>
      decodeBridgeCommandResponse({
        command: {
          id: 'unapplied-delete',
          type: 'delete',
          annotationId: snapshot.annotations[0]?.id,
          createdAt: 1,
        },
        snapshot,
      }),
    ).toThrow('not reflected');
  });
});
