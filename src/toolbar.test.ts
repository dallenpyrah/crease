import { afterEach, expect, it, vi } from 'vitest';
import { type CreasekitHandle, mountCreasekit } from './creasekit';

let handle: CreasekitHandle | undefined;
afterEach(() => {
  handle?.destroy();
  vi.restoreAllMocks();
});

const mount = () => {
  handle = mountCreasekit({ startOpen: true });
  const root = document.querySelector('[data-creasekit-root]')!.shadowRoot!;
  return {
    root,
    layer: root.querySelector<HTMLElement>('.creasekit-layer')!,
    toolbar: root.querySelector<HTMLElement>('.creasekit-toolbar')!,
    grip: root.querySelector<HTMLButtonElement>('.creasekit-drag')!,
  };
};
const shortcut = (code: string, repeat = false) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code, altKey: true, shiftKey: true, repeat }),
  );

it('completely hides the overlay and restores it with either shortcut or the API', () => {
  const { root, layer } = mount();
  root.querySelector<HTMLButtonElement>('[data-action="hide"]')!.click();
  expect(layer.hidden).toBe(true);
  shortcut('KeyH', true);
  expect(layer.hidden).toBe(true);
  shortcut('KeyH');
  expect(layer.hidden).toBe(false);
  shortcut('KeyH');
  expect(layer.hidden).toBe(true);
  shortcut('KeyC');
  expect(layer.hidden).toBe(false);
  shortcut('KeyH');
  handle!.showOutput();
  expect(layer.hidden).toBe(false);
  shortcut('KeyH');
  handle!.open();
  expect(layer.hidden).toBe(false);
});

it('ignores the hide shortcut while typing', () => {
  const { root, layer } = mount();
  root.querySelector('textarea')!.dispatchEvent(
    new KeyboardEvent('keydown', {
      code: 'KeyH',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      composed: true,
    }),
  );
  expect(layer.hidden).toBe(false);
});

it('drags using pointer capture, clamps to the viewport and stops on cancellation', () => {
  const { toolbar, grip } = mount();
  vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(16, 16, 420, 42),
  );
  const capture = vi.fn();
  Object.assign(grip, {
    setPointerCapture: capture,
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  grip.dispatchEvent(
    new PointerEvent('pointerdown', {
      pointerId: 1,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    }),
  );
  expect(capture).toHaveBeenCalledWith(1);
  document.dispatchEvent(
    new PointerEvent('pointermove', { pointerId: 1, clientX: 204, clientY: 154 }),
  );
  expect(toolbar.style.left).toBe('200px');
  expect(toolbar.style.top).toBe('150px');
  document.dispatchEvent(
    new PointerEvent('pointermove', { pointerId: 1, clientX: 10000, clientY: -100 }),
  );
  expect(toolbar.style.left).toBe(`${Math.max(0, window.innerWidth - 420)}px`);
  expect(toolbar.style.top).toBe('0px');
  grip.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
  document.dispatchEvent(
    new PointerEvent('pointermove', { pointerId: 1, clientX: 20, clientY: 20 }),
  );
  expect(toolbar.style.top).toBe('0px');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(500);
  window.dispatchEvent(new Event('resize'));
  expect(toolbar.style.left).toBe('80px');
});

it('moves with arrow keys and keeps the position after hiding and restoring', () => {
  const { toolbar, grip } = mount();
  vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(16, 16, 420, 42),
  );
  grip.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      shiftKey: true,
      bubbles: true,
      composed: true,
    }),
  );
  expect(toolbar.style.left).toBe('56px');
  shortcut('KeyH');
  shortcut('KeyH');
  expect(toolbar.style.left).toBe('56px');
});
