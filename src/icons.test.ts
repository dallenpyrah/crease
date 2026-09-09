import { describe, expect, it, vi } from 'vitest';

import { icon } from './icons';

vi.mock('./assets/creasekit.svg', () => ({
  default:
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" data-label="a&amp;b"></svg>',
}));

describe('packaged logo markup', () => {
  it('preserves quoted data URLs without creating stray markup', () => {
    const container = document.createElement('div');
    container.innerHTML = icon('creasekit');
    const image = container.querySelector('img');

    expect(image?.getAttribute('src')).toBe(
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" data-label="a&amp;b"></svg>',
    );
    expect(container.childNodes).toHaveLength(1);
    expect(container.textContent).toBe('');
  });
});
