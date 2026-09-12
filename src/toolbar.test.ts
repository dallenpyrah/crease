import { afterEach, expect, it, vi } from 'vitest';
import { type CreasekitHandle, mountCreasekit } from './creasekit';

let handle: CreasekitHandle | undefined;
afterEach(() => {
  handle?.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

it('anchors settings and feedback to the toolbar and flips panels above near the bottom', () => {
  const { root, toolbar, grip } = mount();
  vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(16, 16, 420, 42),
  );
  const settings = root.querySelector<HTMLElement>('.creasekit-settings')!;
  const output = root.querySelector<HTMLElement>('.creasekit-output')!;
  vi.spyOn(settings, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(16, 70, 320, 300),
  );
  vi.spyOn(output, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(16, 70, 400, 300),
  );
  root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
  grip.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      shiftKey: true,
      bubbles: true,
      composed: true,
    }),
  );
  expect(settings.style.top).toBe('106px');
  handle!.showOutput();
  expect(output.style.top).toBe('106px');
  vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(16, window.innerHeight - 82, 420, 42),
  );
  grip.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      shiftKey: true,
      bubbles: true,
      composed: true,
    }),
  );
  expect(output.style.top).toBe(`${window.innerHeight - 350}px`);
});

it('keeps tooltips within the viewport and suppresses them during dragging', () => {
  vi.useFakeTimers();
  const { root, grip } = mount();
  const button = root.querySelector<HTMLButtonElement>('[data-action="hide"]')!;
  const tooltip = root.querySelector<HTMLElement>('.creasekit-tooltip')!;
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, window.innerHeight - 32, 32, 32),
  );
  vi.spyOn(tooltip, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 200, 30),
  );
  button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  vi.advanceTimersByTime(350);
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.style.left).toBe('8px');
  expect(tooltip.style.top).toBe(`${window.innerHeight - 70}px`);
  Object.assign(grip, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  grip.dispatchEvent(
    new PointerEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true }),
  );
  button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  vi.advanceTimersByTime(500);
  expect(tooltip.hidden).toBe(true);
  expect(grip.hasAttribute('data-tip')).toBe(false);
});
