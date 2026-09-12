import { afterEach, describe, expect, it } from 'vitest';

import { selectorFor, snapshotElement } from './geometry';

const originalUrl = window.location.href;
afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, '', originalUrl);
});

describe('automatic element location capture', () => {
  it('captures page, named region, rendered sibling position and explicit state', () => {
    window.history.replaceState({}, '', '/mail/123?filter=private#message');
    document.body.innerHTML = `<main><h1>Mail</h1><section aria-labelledby="messages"><h2 id="messages">Message list</h2><div><article><a href="/mail/123?token=hidden#fragment" aria-current="page" aria-label="First message">Message</a></article><article><a href="/mail/456">Next</a></article></div></section></main>`;
    const target = snapshotElement(document.querySelector('a')!);
    expect(target.location).toEqual({
      pagePath: '/mail/123',
      pageHeading: 'Mail',
      region: {
        role: 'section',
        label: 'Message list',
        labelSource: 'aria-labelledby',
      },
      accessibleName: 'First message',
      position: { index: 1, total: 2, kind: 'rendered-sibling' },
      current: 'page',
      href: `${window.location.origin}/mail/123`,
    });
    expect(JSON.stringify(target.location)).not.toContain('token');
  });

  it('uses opaque generated references instead of class and position selectors', () => {
    const ref = 'ck_00000000-0000-4000-8000-000000000001';
    document.body.innerHTML = `<section><button data-creasekit-ref="${ref}">Deploy</button></section>`;
    const button = document.querySelector('button')!;
    expect(selectorFor(button)).toBe(`[data-creasekit-ref="${ref}"]`);
    expect(snapshotElement(button).reference).toBe(ref);
    document.body.append(button.cloneNode(true));
    expect(selectorFor(button)).not.toBe(`[data-creasekit-ref="${ref}"]`);
  });

  it('does not invent business names or active state from generated classes', () => {
    document.body.innerHTML =
      '<section class="mailList"><article><a class="active">Message</a></article></section>';
    const location = snapshotElement(document.querySelector('a')!).location;
    expect(location?.region).toEqual({
      role: 'section',
      label: 'section',
      labelSource: 'tag',
    });
    expect(location?.current).toBeUndefined();
    expect(location?.selected).toBeUndefined();
    expect(location?.pageHeading).toBeUndefined();
  });

  it('does not capture private labels, form values or external link destinations', () => {
    document.body.innerHTML =
      '<main><h1 data-creasekit-private>Private page name</h1><h2 id="secret" data-creasekit-private>Private region</h2><section aria-labelledby="secret"><a href="https://example.com/private" aria-labelledby="secret">Public</a><input aria-label="Private form label" value="Private value"/><div data-creasekit-private><a href="/private" aria-label="Private name">Private</a></div></section></main>';
    const target = snapshotElement(document.querySelector('a')!);
    expect(target.location?.pageHeading).toBeUndefined();
    expect(target.location?.accessibleName).toBeUndefined();
    expect(target.location?.href).toBeUndefined();
    expect(JSON.stringify(target.location)).not.toContain('Private');
    expect(snapshotElement(document.querySelector('input')!).location).toEqual({
      pagePath: window.location.pathname,
    });
    expect(
      snapshotElement(document.querySelector('[data-creasekit-private] a')!).location,
    ).toEqual({ pagePath: window.location.pathname });
  });

  it('captures rendered order without rewriting a previous snapshot after reordering', () => {
    document.body.innerHTML =
      '<ul role="list" aria-label="Messages"><li aria-selected="true">First</li><li>Second</li><li hidden>Hidden</li></ul>';
    const first = document.querySelector('li')!;
    const captured = snapshotElement(first);
    first.parentElement!.append(first);
    expect(captured.location?.position).toEqual({
      index: 1,
      total: 2,
      kind: 'rendered-sibling',
    });
    expect(captured.location?.selected).toBe(true);
    expect(snapshotElement(first).location?.position?.index).toBe(2);
  });
});
