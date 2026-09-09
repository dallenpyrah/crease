import { describe, expect, it } from 'vitest';

import { selectorFor, snapshotElement } from './geometry';

describe('creasekit DOM context', () => {
  it('creates a stable selector anchored at the nearest unique id', () => {
    document.body.innerHTML = `
      <main id="workspace">
        <section class="panel">
          <button class="primary">Deploy</button>
          <button class="secondary">Cancel</button>
        </section>
      </main>
    `;
    const button = document.querySelector('button.primary');
    if (button === null) {
      throw new Error('button fixture was not found');
    }
    expect(selectorFor(button)).toBe(
      '#workspace > section.panel > button.primary:nth-of-type(1)',
    );
  });

  it('captures semantic element context without exposing the overlay', () => {
    document.body.innerHTML = `<button id="deploy" role="button" class="primary">Deploy</button>`;
    const button = document.querySelector('#deploy');
    if (button === null) {
      throw new Error('button fixture was not found');
    }
    const target = snapshotElement(button);
    expect(target.tag).toBe('button');
    expect(target.role).toBe('button');
    expect(target.text).toBe('Deploy');
    expect(target.selector).toBe('#deploy');
  });

  it('honors both current and pre-rename private-region markers', () => {
    for (const attribute of ['data-creasekit-private', 'data-crease-private']) {
      document.body.innerHTML = `<main><span>Public label</span><section ${attribute}><span>Private value</span></section></main>`;
      const parent = document.querySelector('main');
      const privateChild = document.querySelector('section span');
      if (parent === null || privateChild === null)
        throw new Error('Missing privacy fixture');
      expect(snapshotElement(parent).text).toBe('Public label');
      expect(snapshotElement(privateChild).text).toBe('[redacted]');
    }
  });
});
