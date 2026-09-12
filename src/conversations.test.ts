import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCommand, AgentSnapshot, AgentSyncRequest } from './agent-contract';
import { type CreasekitHandle, mountCreasekit } from './creasekit';

describe('automatically synced annotation conversations', () => {
  let handle: CreasekitHandle;
  let root: ShadowRoot;
  let target: HTMLButtonElement;
  let pending: ReadonlyArray<AgentCommand>;
  let snapshot: AgentSnapshot;
  const unshare = vi.fn().mockResolvedValue(undefined);
  const sync = vi.fn(async (request: AgentSyncRequest) => {
    snapshot = request.snapshot;
    pending = pending.filter(
      (command) => !request.acknowledgedCommandIds.includes(command.id),
    );
    return { commands: pending };
  });
  const element = <T extends Element>(selector: string): T =>
    root.querySelector<T>(selector)!;
  const click = (action: string): void =>
    element<HTMLButtonElement>(`[data-action="${action}"]`).click();
  const add = (comment: string): void => {
    handle.open();
    if (!element<HTMLElement>('.creasekit-output').hidden) click('close-output');
    target.click();
    click('compose');
    const input = element<HTMLTextAreaElement>('.creasekit-composer textarea');
    input.value = comment;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    click('add');
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', new Storage());
    document.body.innerHTML = '<button id="conversation-target">Deploy</button>';
    target = document.querySelector<HTMLButtonElement>('#conversation-target')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 100, 100, 40),
    );
    pending = [];
    sync.mockClear();
    unshare.mockClear();
    handle = mountCreasekit({
      projectId: 'conversations',
      startOpen: true,
      agent: { sync, share: vi.fn(), unshare },
    });
    root = document.querySelector('[data-creasekit-root]')!.shadowRoot!;
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    handle.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('automatically exposes feedback, removes sharing/status controls, and supports an undoable clear-all', async () => {
    add('Increase padding');
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot.annotations).toHaveLength(1);
    click('open-output');
    expect(root.querySelector('[data-action="share"]')).toBeNull();
    expect(root.querySelector('[data-action="toggle-status"]')).toBeNull();
    expect(root.querySelector('.creasekit-list-item-status')).toBeNull();
    click('clear-annotations');
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot.annotations).toHaveLength(0);
    expect(
      element<HTMLButtonElement>('[data-action="clear-annotations"]').disabled,
    ).toBe(true);
    click('undo');
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot.annotations[0]?.comment).toBe('Increase padding');
  });

  it('applies agent replies once, preserves an in-progress user draft and persists the conversation', async () => {
    add('Increase padding');
    await vi.advanceTimersByTimeAsync(1);
    const id = snapshot.annotations[0]!.id;
    click('open-output');
    const input = element<HTMLTextAreaElement>('.creasekit-reply');
    input.value = 'Also on mobile';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.focus();
    input.setSelectionRange(4, 4);
    pending = [
      {
        id: 'reply-1',
        type: 'reply',
        annotationId: id,
        comment: '<b>Done</b>',
        createdAt: Date.now(),
      },
    ];
    await vi.advanceTimersByTimeAsync(1005);
    expect(snapshot.annotations[0]?.replies).toHaveLength(1);
    expect(element('.creasekit-message p').textContent).toBe('<b>Done</b>');
    expect(root.querySelector('.creasekit-message b')).toBeNull();
    expect(element<HTMLTextAreaElement>('.creasekit-reply').value).toBe(
      'Also on mobile',
    );
    expect(shadowReplySelection()).toBe(4);
    pending = [
      {
        id: 'reply-1',
        type: 'reply',
        annotationId: id,
        comment: '<b>Done</b>',
        createdAt: Date.now(),
      },
    ];
    await vi.advanceTimersByTimeAsync(1005);
    expect(snapshot.annotations[0]?.replies).toHaveLength(1);
    click('reply');
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot.annotations[0]?.replies?.map((reply) => reply.author)).toEqual([
      'agent',
      'user',
    ]);
    const stored = JSON.parse(
      window.localStorage.getItem('creasekit:conversations:annotations')!,
    );
    expect(stored[0].replies[1].comment).toBe('Also on mobile');
    expect(pending).toHaveLength(0);
    handle.destroy();
    handle = mountCreasekit({ projectId: 'conversations', startOpen: true });
    root = document.querySelector('[data-creasekit-root]')!.shadowRoot!;
    handle.showOutput();
    expect(root.querySelectorAll('.creasekit-message')).toHaveLength(2);
  });

  const shadowReplySelection = () => {
    const active = root.activeElement;
    return active instanceof HTMLTextAreaElement ? active.selectionStart : null;
  };

  it('keeps annotations added after the agent requested a clear, including while hidden', async () => {
    add('First');
    await vi.advanceTimersByTimeAsync(1);
    const first = snapshot.annotations[0]!.id;
    add('Concurrent feedback');
    await vi.advanceTimersByTimeAsync(1);
    pending = [
      { id: 'clear-1', type: 'clear', annotationIds: [first], createdAt: Date.now() },
    ];
    click('hide');
    await vi.advanceTimersByTimeAsync(1005);
    expect(element<HTMLElement>('.creasekit-layer').hidden).toBe(true);
    expect(snapshot.annotations.map((annotation) => annotation.comment)).toEqual([
      'Concurrent feedback',
    ]);
    expect(element<HTMLButtonElement>('[data-action="undo"]').disabled).toBe(true);
    pending = [
      {
        id: 'delete-1',
        type: 'delete',
        annotationId: snapshot.annotations[0]!.id,
        createdAt: Date.now(),
      },
    ];
    await vi.advanceTimersByTimeAsync(1005);
    expect(snapshot.annotations).toHaveLength(0);
    expect(
      JSON.parse(window.localStorage.getItem('creasekit:conversations:annotations')!),
    ).toEqual([]);
  });

  it('does not apply a command delivered after its acknowledgement deadline', async () => {
    add('Keep this feedback');
    await vi.advanceTimersByTimeAsync(1);
    pending = [
      {
        id: 'expired-clear',
        type: 'clear',
        annotationIds: [snapshot.annotations[0]!.id],
        createdAt: Date.now() - 60000,
      },
    ];
    await vi.advanceTimersByTimeAsync(1005);
    expect(snapshot.annotations[0]?.comment).toBe('Keep this feedback');
    expect(pending).toHaveLength(0);
  });

  it('removes its browser session on navigation and resumes from the back-forward cache', async () => {
    add('Keep the conversation across navigation');
    await vi.advanceTimersByTimeAsync(1);
    const calls = sync.mock.calls.length;
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(unshare).toHaveBeenCalledOnce();
    expect(sync.mock.calls.length).toBe(calls);
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.mock.calls.length).toBeGreaterThan(calls);
    expect(snapshot.annotations[0]?.comment).toBe(
      'Keep the conversation across navigation',
    );
  });

  it('discards commands from a sync interrupted by navigation', async () => {
    add('Keep this conversation');
    await vi.advanceTimersByTimeAsync(1);
    let finish = (_response: { commands: ReadonlyArray<AgentCommand> }): void => {};
    sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    finish({
      commands: [
        {
          id: 'cancelled-clear',
          type: 'clear',
          annotationIds: [snapshot.annotations[0]!.id],
          createdAt: Date.now(),
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot.annotations[0]?.comment).toBe('Keep this conversation');
  });
});
