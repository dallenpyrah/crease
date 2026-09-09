import { Effect } from 'effect';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeAnnotation } from './domain';
import { snapshotElement } from './geometry';
import { makeLocalPersistence } from './persistence';

beforeEach(() => vi.stubGlobal('localStorage', new Storage()));
afterEach(() => vi.unstubAllGlobals());

describe('annotation storage across the product rename', () => {
  it('retains existing notes and writes subsequent changes under creasekit', () => {
    const annotation = makeAnnotation(
      snapshotElement(document.createElement('button')),
      'Keep this feedback',
      1,
      'existing',
    );
    window.localStorage.setItem(
      'crease:my-app:annotations',
      JSON.stringify([annotation]),
    );
    const storage = makeLocalPersistence('my-app');

    expect(Effect.runSync(storage.load)).toEqual([annotation]);
    Effect.runSync(storage.save([]));
    expect(window.localStorage.getItem('creasekit:my-app:annotations')).toBe('[]');
    expect(Effect.runSync(storage.load)).toEqual([]);
  });

  it('retains notes from the renamed demo project', () => {
    const annotation = makeAnnotation(
      snapshotElement(document.createElement('button')),
      'Saved demo feedback',
      1,
      'demo',
    );
    window.localStorage.setItem(
      'crease:crease-homepage:annotations',
      JSON.stringify([annotation]),
    );

    expect(Effect.runSync(makeLocalPersistence('creasekit-homepage').load)).toEqual([
      annotation,
    ]);
  });
});
