import { afterEach, expect, it } from 'vitest';

import {
  automaticInspector,
  captureCall,
  observeRuntime,
  resetAutomaticContext,
} from './automatic-context';

const source = (view: string, line: number) => ({
  file: 'src/mail.ts',
  view,
  line,
  column: 1,
  endLine: line + 2,
  endColumn: 2,
  revision: 'a'.repeat(64),
});

const node = (elm: Element, children: unknown[] = [], key?: string) => ({
  sel: elm.tagName.toLowerCase(),
  data: {},
  elm,
  children,
  ...(key === undefined ? {} : { key }),
});

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => {
  resetAutomaticContext();
  document.body.replaceChildren();
});

it('associates one shared definition with observed helper callers and parent layout', async () => {
  const list = document.createElement('section');
  list.style.cssText = 'display:flex;padding:0px;border:1px solid black;gap:4px';
  const first = document.createElement('a');
  const second = document.createElement('a');
  list.append(first, second);
  document.body.append(list);
  const row = (element: Element) =>
    captureCall(() => node(element), undefined, [], source('row', 20), 'element');
  const runtime = observeRuntime(
    {
      view: () =>
        captureCall(
          () =>
            node(list, [
              captureCall(row, undefined, [first], source('list', 10), 'helper'),
              captureCall(row, undefined, [second], source('list', 14), 'helper'),
            ]),
          undefined,
          [],
          source('list', 8),
          'element',
        ),
    },
    source('list', 5),
  );
  runtime.view();
  await flush();
  const a = automaticInspector.inspect(first, false);
  const b = automaticInspector.inspect(second, false);
  expect(a?.elementSource).toEqual(source('row', 20));
  expect(a?.elementSource).toEqual(b?.elementSource);
  expect(a?.calls).toEqual([{ kind: 'helper', source: source('list', 10) }]);
  expect(b?.calls).toEqual([{ kind: 'helper', source: source('list', 14) }]);
  expect(a?.layout?.[0]).toMatchObject({
    tag: 'section',
    source: source('list', 8),
    padding: '0px',
    gap: '4px',
  });
  expect(a?.layout?.length).toBeLessThanOrEqual(4);
  expect(a?.model).toBeUndefined();
});

it('keeps keyed identity private and references stable across keyed recreation', async () => {
  const container = document.createElement('main');
  document.body.append(container);
  let rows = ['private-message-a', 'private-message-b'];
  const runtime = observeRuntime(
    {
      view: () => {
        const children = rows.map((key) => {
          const element = document.createElement('a');
          const result = captureCall(
            () => node(element, [], key),
            undefined,
            [],
            source('row', 20),
            'element',
          );
          return { element, result };
        });
        container.replaceChildren(...children.map(({ element }) => element));
        return captureCall(
          () =>
            node(
              container,
              children.map(({ result }) => result),
            ),
          undefined,
          [],
          source('list', 8),
          'element',
        );
      },
    },
    source('list', 5),
  );
  runtime.view();
  await flush();
  const original = container.children[0]!;
  const ref = original.getAttribute('data-creasekit-ref');
  const context = automaticInspector.inspect(original, false)!;
  expect(ref).toMatch(/^ck_/);
  expect(JSON.stringify(context)).not.toContain('private-message');
  rows = [...rows].reverse();
  runtime.view();
  await flush();
  expect(container.children[1]!.getAttribute('data-creasekit-ref')).toBe(ref);
  expect(automaticInspector.resolve?.(context)).toBe(container.children[1]);
  expect(original.hasAttribute('data-creasekit-ref')).toBe(false);
  resetAutomaticContext();
  expect(container.querySelector('[data-creasekit-ref]')).toBeNull();
  expect(automaticInspector.resolve?.(context)).toBeUndefined();
});

it('does not associate private nodes or overwrite authored reference attributes', async () => {
  const root = document.createElement('main');
  const privateRow = document.createElement('a');
  privateRow.setAttribute('data-creasekit-private', '');
  const authored = document.createElement('button');
  authored.setAttribute('data-creasekit-ref', 'authored');
  root.append(privateRow, authored);
  document.body.append(root);
  const runtime = observeRuntime(
    {
      view: () =>
        captureCall(
          () =>
            node(root, [
              captureCall(
                () => node(privateRow),
                undefined,
                [],
                source('row', 20),
                'element',
              ),
              captureCall(
                () => node(authored),
                undefined,
                [],
                source('button', 30),
                'element',
              ),
            ]),
          undefined,
          [],
          source('list', 8),
          'element',
        ),
    },
    source('list', 5),
  );
  runtime.view();
  await flush();
  expect(automaticInspector.inspect(privateRow, false)).toBeUndefined();
  expect(privateRow.hasAttribute('data-creasekit-ref')).toBe(false);
  expect(authored.getAttribute('data-creasekit-ref')).toBe('authored');
  resetAutomaticContext();
  expect(authored.getAttribute('data-creasekit-ref')).toBe('authored');
});
