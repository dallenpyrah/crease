import { describe, expect, it } from 'vitest';

import { createFoldkitInspector } from './foldkit-context';

const fixture = () => {
  document.body.innerHTML =
    '<button id="increment"><span>+</span></button><div id="other">Other</div>';
  const element = document.querySelector('#increment span');
  if (element === null) throw new Error('Missing counter fixture');
  const initialModel = { count: 0, privateField: 'excluded', apiToken: 'test-fixture' };
  const inspector = createFoldkitInspector({
    initialModel,
    registrations: [
      {
        boundary: 'Counter',
        source: { file: 'src/main.ts', view: 'counterView' },
        targets: [
          {
            selector: '#increment',
            events: [{ event: 'click', message: 'Incremented' }],
          },
        ],
        project: (model) => ({ count: model.count, apiToken: model.apiToken }),
      },
    ],
  });
  return { inspector, element, initialModel };
};

describe('explicit FoldKit context adapter', () => {
  it('synchronizes an initial or HMR-restored render without inventing a Message', () => {
    const { inspector, element, initialModel } = fixture();
    const rendered = { body: 'rendered view' };
    const view = inspector.observeView(
      (_model: typeof initialModel, _builder: unknown) => rendered,
    );
    expect(view({ ...initialModel, count: 7 }, null)).toBe(rendered);
    expect(inspector.inspect(element, true)?.model?.count).toBe(7);
    expect(inspector.inspect(element, true)?.history).toEqual([]);
  });
  it('maps a nested target to registered source and static Message metadata', () => {
    const { inspector, element } = fixture();
    const context = inspector.inspect(element, false);
    expect(context?.source).toEqual({ file: 'src/main.ts', view: 'counterView' });
    expect(context?.events).toEqual([{ event: 'click', message: 'Incremented' }]);
    expect(context?.model).toBeUndefined();
    expect(context?.history).toBeUndefined();
    expect(inspector.inspect(document.body, true)).toBeUndefined();
  });

  it('only includes allowlisted state and redacts sensitive keys after consent', () => {
    const { inspector, element } = fixture();
    expect(inspector.inspect(element, true)?.model).toEqual({
      count: 0,
      apiToken: '[redacted]',
    });
    expect(inspector.inspect(element, true)?.model).not.toHaveProperty('privateField');
  });

  it('observes the actual update result without changing its Model or Commands', () => {
    const { inspector, element, initialModel } = fixture();
    const result = { model: { ...initialModel, count: 1 }, commands: [] };
    const update = inspector.observeUpdate(
      (_model: typeof initialModel, _message: { _tag: string }) => result,
    );
    expect(update(initialModel, { _tag: 'Incremented' })).toBe(result);
    const context = inspector.inspect(element, true);
    expect(context?.model?.count).toBe(1);
    expect(context?.history).toMatchObject([
      { message: 'Incremented', before: { count: 0 }, after: { count: 1 } },
    ]);
  });

  it('bounds history and does not retain irrelevant unchanged updates', () => {
    const { inspector, element, initialModel } = fixture();
    let model = initialModel;
    const update = inspector.observeUpdate(
      (current: typeof initialModel, _message: { _tag: string }) => ({
        model: { ...current, count: current.count + 1 },
      }),
    );
    for (let index = 0; index < 15; index++)
      model = update(model, { _tag: 'Incremented' }).model;
    inspector.observeUpdate(
      (current: typeof initialModel, _message: { _tag: string }) => ({
        model: current,
      }),
    )(model, { _tag: 'Unrelated' });
    const context = inspector.inspect(element, true);
    expect(context?.history).toHaveLength(10);
    expect(context?.history?.at(-1)?.message).toBe('Incremented');
    expect(context?.model?.count).toBe(15);
  });

  it('detaches listeners and returns independent context snapshots', () => {
    const { inspector, element, initialModel } = fixture();
    let notifications = 0;
    const unsubscribe = inspector.subscribe(() => notifications++);
    const update = inspector.observeUpdate(
      (model: typeof initialModel, _message: { _tag: string }) => ({ model }),
    );
    update(initialModel, { _tag: 'Incremented' });
    unsubscribe();
    update(initialModel, { _tag: 'Incremented' });
    expect(notifications).toBe(1);
    expect(inspector.inspect(element, true)?.history).not.toBe(
      inspector.inspect(element, true)?.history,
    );
  });

  it('rejects source paths outside the project and contains projection failures', () => {
    expect(() =>
      createFoldkitInspector({
        initialModel: {},
        registrations: [
          {
            boundary: 'Unsafe',
            source: { file: '../private.ts', view: 'view' },
            targets: [],
            project: () => ({}),
          },
        ],
      }),
    ).toThrow('project-relative');
    const { element } = fixture();
    const inspector = createFoldkitInspector({
      initialModel: {},
      registrations: [
        {
          boundary: 'Counter',
          source: { file: 'src/main.ts', view: 'view' },
          targets: [{ selector: '#increment', events: [] }],
          project: () => {
            throw new Error('Unavailable');
          },
        },
      ],
    });
    expect(inspector.inspect(element, true)?.model).toEqual({
      status: 'The registered Model projection could not be read.',
    });
  });
});
