import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CreasekitHandle,
  type CreasekitOptions,
  mountCreasekit,
} from './creasekit';
import { createFoldkitInspector } from './foldkit-context';

describe('creasekit overlay interactions', () => {
  let creasekit: CreasekitHandle;
  let root: ShadowRoot;
  let target: HTMLButtonElement;

  const element = <T extends Element>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (found === null) throw new Error(`Missing fixture element ${selector}`);
    return found;
  };
  const click = (action: string): void =>
    element<HTMLButtonElement>(`[data-action="${action}"]`).click();
  const draft = (comment: string): void => {
    const textarea = element<HTMLTextAreaElement>('textarea');
    textarea.value = comment;
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  };
  const output = (): string =>
    element<HTMLElement>('.creasekit-output-code').textContent ?? '';

  const remount = (options: CreasekitOptions): void => {
    creasekit.destroy();
    creasekit = mountCreasekit({ projectId: 'test', startOpen: true, ...options });
    const shadow = document.querySelector('[data-creasekit-root]')?.shadowRoot;
    if (!shadow) throw new Error('Missing remounted overlay');
    root = shadow;
  };

  const foldkit = () =>
    createFoldkitInspector({
      initialModel: { count: 3 },
      registrations: [
        {
          boundary: 'Counter',
          source: { file: 'src/main.ts', view: 'view' },
          targets: [
            {
              selector: '#target',
              events: [{ event: 'click', message: 'ClickedReset' }],
            },
          ],
          project: (model) => ({ count: model.count }),
        },
      ],
    });

  beforeEach(() => {
    vi.stubGlobal('localStorage', new Storage());
    window.localStorage.clear();
    document.body.innerHTML = '<button id="target">Deploy latest</button>';
    const button = document.querySelector<HTMLButtonElement>('#target');
    if (button === null) throw new Error('Missing target');
    target = button;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 100, 120, 40),
    );
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    creasekit = mountCreasekit({ projectId: 'test', startOpen: true });
    const shadow = document.querySelector('[data-creasekit-root]')?.shadowRoot;
    if (!shadow) throw new Error('Missing overlay root');
    root = shadow;
  });

  afterEach(() => {
    creasekit.destroy();
    vi.restoreAllMocks();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('switches export tabs and persists edited notes with undo and redo', () => {
    target.click();
    click('compose');
    draft('Use a 12px gap.');
    click('add');
    expect(element<HTMLElement>('.creasekit-pin').textContent).toBe('1');
    click('open-output');
    element<HTMLButtonElement>('[data-output-format="json"]').click();
    expect(JSON.parse(output())[0].comment).toBe('Use a 12px gap.');
    expect(
      element<HTMLButtonElement>('[data-output-format="json"]').getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
    element<HTMLButtonElement>('[data-output-format="markdown"]').click();
    expect(output()).toContain('**Feedback:** Use a 12px gap.');
    click('undo');
    expect(output()).not.toContain('Use a 12px gap.');
    click('redo');
    expect(output()).toContain('Use a 12px gap.');
    expect(
      JSON.parse(window.localStorage.getItem('creasekit:test:annotations') ?? '[]')[0]
        .comment,
    ).toBe('Use a 12px gap.');
    click('edit-note');
    draft('Use a 16px gap instead.');
    click('add');
    expect(
      JSON.parse(window.localStorage.getItem('creasekit:test:annotations') ?? '[]')[0]
        .comment,
    ).toBe('Use a 16px gap instead.');
  });

  it('never captures host clicks when inactive and removes its listeners on destroy', () => {
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    target.click();
    expect(clicked).not.toHaveBeenCalled();
    creasekit.close();
    target.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    creasekit.open();
    creasekit.destroy();
    target.click();
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-creasekit-root]')).toBeNull();
  });

  it('renders note content as text rather than executable markup', () => {
    target.click();
    click('compose');
    draft('<img src=x onerror="alert(1)">');
    click('add');
    expect(root.querySelector('.creasekit-list img')).toBeNull();
    expect(element('.creasekit-list-item-comment').textContent).toBe(
      '<img src=x onerror="alert(1)">',
    );
  });

  it('toggles working measurement controls without changing the page styles', () => {
    const style = target.getAttribute('style');
    click('rulers');
    expect(element('.creasekit-rulers').childElementCount).toBeGreaterThan(0);
    click('xray');
    expect(element('.creasekit-xray').childElementCount).toBeGreaterThan(0);
    expect(target.getAttribute('style')).toBe(style);
    creasekit.close();
    expect(element('.creasekit-rulers').childElementCount).toBe(0);
    expect(element('.creasekit-xray').childElementCount).toBe(0);
  });

  it('copies the selected export format to the clipboard', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    target.click();
    click('compose');
    draft('Make the button wider.');
    click('add');
    click('open-output');
    element<HTMLButtonElement>('[data-output-format="json"]').click();
    click('copy-output');
    expect(write).toHaveBeenLastCalledWith(output());
    expect(JSON.parse(output())[0].comment).toBe('Make the button wider.');
    element<HTMLButtonElement>('[data-output-format="markdown"]').click();
    click('copy-output');
    expect(write).toHaveBeenLastCalledWith(output());
    expect(output()).toContain('**Feedback:** Make the button wider.');
    await Promise.resolve();
    expect(element('.creasekit-toast').textContent).toBe('Copied to clipboard');
  });

  it('reattaches persisted note pins on a fresh mount', () => {
    target.click();
    click('compose');
    draft('Keep this note after reload.');
    click('add');
    creasekit.destroy();
    creasekit = mountCreasekit({ projectId: 'test', startOpen: true });
    const shadow = document.querySelector('[data-creasekit-root]')?.shadowRoot;
    if (!shadow) throw new Error('Missing remounted overlay');
    root = shadow;
    expect(element('.creasekit-pin').getAttribute('aria-label')).toContain(
      'Keep this note after reload.',
    );
    expect(element('.creasekit-list-item-comment').textContent).toBe(
      'Keep this note after reload.',
    );
  });

  it('offers a selectable exact-payload fallback when clipboard access is denied', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
    target.click();
    click('copy-selected');
    await vi.waitFor(() =>
      expect(element<HTMLElement>('.creasekit-output').hidden).toBe(false),
    );
    expect(JSON.parse(output()).target.selector).toBe('#target');
    expect(element('.creasekit-toast').textContent).toContain('Select the export text');
  });

  it('reports memory-only notes rather than a false save on storage failure', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    target.click();
    click('compose');
    draft('Keep this note safe.');
    click('add');
    expect(element<HTMLElement>('.creasekit-storage-warning').hidden).toBe(false);
    expect(element('.creasekit-toast').textContent).toContain('memory only');
    expect(element('.creasekit-list-item-comment').textContent).toBe(
      'Keep this note safe.',
    );
  });

  it('allows editing detached notes without inventing a live target', () => {
    target.click();
    click('compose');
    draft('Original feedback.');
    click('add');
    target.remove();
    click('open-output');
    click('edit-note');
    expect(element('.creasekit-details').textContent).toContain('Detached');
    draft('Updated while detached.');
    click('add');
    expect(element('.creasekit-list-item-comment').textContent).toBe(
      'Updated while detached.',
    );
    expect(
      JSON.parse(window.localStorage.getItem('creasekit:test:annotations') ?? '[]')[0]
        .target.selector,
    ).toBe('#target');
  });

  it('supports roving keyboard focus between export tabs', () => {
    click('open-output');
    const notes = element<HTMLButtonElement>('[data-output-format="notes"]');
    notes.focus();
    notes.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        composed: true,
      }),
    );
    expect(
      element('[data-output-format="markdown"]').getAttribute('aria-selected'),
    ).toBe('true');
    expect(element<HTMLButtonElement>('[data-output-format="notes"]').tabIndex).toBe(
      -1,
    );
    expect(root.activeElement).toBe(element('[data-output-format="markdown"]'));
  });

  it('shares only explicit opt-in scoped context and never persists Model data', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const unshare = vi.fn().mockResolvedValue(undefined);
    remount({ foldkit: foldkit(), agent: { share, unshare } });
    target.click();
    expect(root.querySelector('.creasekit-model-code')).toBeNull();
    expect(share.mock.calls[0]?.[0].selection).toBeNull();
    await vi.waitFor(() =>
      expect(element('.creasekit-agent-status').textContent).toContain(
        'available to your agent',
      ),
    );
    click('toggle-model');
    expect(element('.creasekit-model-code').textContent).toContain('3');
    click('compose');
    draft('Reset should be easier to find.');
    click('add');
    const stored = JSON.parse(
      window.localStorage.getItem('creasekit:test:annotations') ?? '[]',
    );
    expect(stored[0].foldkit.source.file).toBe('src/main.ts');
    expect(stored[0].foldkit.model).toBeUndefined();
    expect(stored[0].foldkit.history).toBeUndefined();
    click('open-output');
    await vi.waitFor(() =>
      expect(share.mock.calls.at(-1)?.[0].annotations).toHaveLength(1),
    );
    expect(share.mock.calls.at(-1)?.[0].selection.foldkit.model).toEqual({ count: 3 });
    expect(share.mock.calls.at(-1)?.[0].annotations[0].foldkit.model).toEqual({
      count: 3,
    });
    click('settings');
    const input = element<HTMLInputElement>('[data-setting="model"]');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() =>
      expect(share.mock.calls.at(-1)?.[0].annotations[0].foldkit.model).toBeUndefined(),
    );
    click('open-output');
    element<HTMLButtonElement>('[data-output-format="json"]').click();
    expect(JSON.parse(output())[0].foldkit.model).toBeUndefined();
  });

  it('shows FoldKit context only for a registered target, without an empty-state section', () => {
    remount({ foldkit: foldkit() });
    target.click();
    expect(element<HTMLElement>('.creasekit-foldkit').hidden).toBe(false);
    expect(element('.creasekit-foldkit').textContent).toContain('src/main.ts');
    target.id = 'unregistered';
    target.click();
    expect(element<HTMLElement>('.creasekit-foldkit').hidden).toBe(true);
    expect(element('.creasekit-foldkit').childElementCount).toBe(0);
  });

  it('revokes an in-flight shared Model snapshot if consent is withdrawn', async () => {
    let finishShare = () => {};
    const pending = new Promise<void>((resolve) => {
      finishShare = resolve;
    });
    const share = vi.fn(() => pending).mockResolvedValueOnce(undefined);
    const unshare = vi.fn().mockResolvedValue(undefined);
    remount({ foldkit: foldkit(), agent: { share, unshare } });
    await vi.waitFor(() =>
      expect(element('.creasekit-agent-status').textContent).toContain(
        'available to your agent',
      ),
    );
    target.click();
    click('toggle-model');
    click('open-output');
    click('settings');
    const input = element<HTMLInputElement>('[data-setting="model"]');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    finishShare();
    await vi.waitFor(() => expect(unshare).toHaveBeenCalledOnce());
    expect(root.querySelector('[data-action="unshare"]')).toBeNull();
  });
});
