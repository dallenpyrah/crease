import { Storage } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { type CreasekitHandle, mountCreasekit } from './creasekit';

let handle: CreasekitHandle;
let root: ShadowRoot;
let target: HTMLAnchorElement;
const ref = 'ck_00000000-0000-4000-8000-000000000001';
const click = (action: string) =>
  root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();

beforeEach(() => {
  vi.stubGlobal('localStorage', new Storage());
  document.body.innerHTML = `<a id="row" href="/mail/first" data-creasekit-ref="${ref}">First message</a>`;
  target = document.querySelector('a')!;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 100, 200, 50),
  );
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  handle = mountCreasekit({ projectId: 'ref-resolution', startOpen: true });
  root = document.querySelector('[data-creasekit-root]')!.shadowRoot!;
  target.click();
  click('compose');
  const input = root.querySelector('textarea')!;
  input.value = 'Add space above this message';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  click('add');
  expect(root.querySelectorAll('.creasekit-pin')).toHaveLength(1);
});

afterEach(() => {
  handle.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('reattaches to a recreated element carrying the same verified reference', () => {
  const replacement = target.cloneNode(true);
  if (!(replacement instanceof Element)) throw new Error('Expected element');
  vi.spyOn(replacement, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 160, 200, 50),
  );
  target.replaceWith(replacement);
  click('open-output');
  expect(root.querySelectorAll('.creasekit-pin')).toHaveLength(1);
});

it('does not fall back to a positional selector when a reference is absent or duplicated', () => {
  const duplicate = target.cloneNode(true);
  if (!(duplicate instanceof Element)) throw new Error('Expected element');
  document.body.append(duplicate);
  click('open-output');
  expect(root.querySelectorAll('.creasekit-pin')).toHaveLength(0);
  duplicate.remove();
  target.removeAttribute('data-creasekit-ref');
  click('close-output');
  expect(root.querySelectorAll('.creasekit-pin')).toHaveLength(0);
});

it('does not attach a saved annotation to a recycled link for another message', () => {
  target.href = '/mail/second';
  click('open-output');
  expect(root.querySelectorAll('.creasekit-pin')).toHaveLength(0);
  expect(root.querySelector('.creasekit-list-item-head')!.textContent).toContain(
    'Detached',
  );
});
