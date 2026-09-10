import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAutomaticCreasekit } from './automatic-entry';
import { mountCreasekit } from './creasekit';
import { getDefaultFoldkitInspector } from './foldkit-context';

const disposals: Array<() => void> = [];

beforeEach(() => {
  vi.stubGlobal('localStorage', new Storage());
  document.body.replaceChildren();
});

afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('automatic overlay lifecycle', () => {
  it('mounts once, starts collapsed, and accepts a later explicit inspector', () => {
    disposals.push(
      startAutomaticCreasekit({
        projectId: 'auto-mount',
        autoMount: true,
        excludeModelKeys: [],
      }),
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.querySelectorAll('[data-creasekit-root]')).toHaveLength(1);
    const root = document.querySelector('[data-creasekit-root]')?.shadowRoot;
    expect(
      root?.querySelector('.creasekit-launcher')?.getAttribute('aria-expanded'),
    ).toBe('false');
    const unsubscribe = vi.fn();
    const inspector = { inspect: vi.fn(), subscribe: vi.fn(() => unsubscribe) };
    const manual = mountCreasekit({ foldkit: inspector });
    expect(document.querySelectorAll('[data-creasekit-root]')).toHaveLength(1);
    expect(inspector.subscribe).toHaveBeenCalledOnce();
    manual.destroy();
    manual.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-creasekit-root]')).toBeNull();
  });

  it('allows manual mounting while automatic context is still installed', () => {
    const dispose = startAutomaticCreasekit({
      projectId: 'manual-mount',
      autoMount: false,
      excludeModelKeys: [],
    });
    disposals.push(dispose);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.querySelector('[data-creasekit-root]')).toBeNull();
    expect(getDefaultFoldkitInspector()).toBeDefined();
    const manual = mountCreasekit();
    disposals.push(manual.destroy);
    expect(document.querySelectorAll('[data-creasekit-root]')).toHaveLength(1);
    dispose();
    expect(getDefaultFoldkitInspector()).toBeUndefined();
    expect(document.querySelectorAll('[data-creasekit-root]')).toHaveLength(1);
  });
});
