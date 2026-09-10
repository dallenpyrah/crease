import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AutomaticSource,
  automaticInspector,
  captureCall,
  configureAutomaticContext,
  observeRuntime,
  registerFunction,
  resetAutomaticContext,
} from './automatic-context.js';

type FixtureVNode = {
  readonly sel: string;
  readonly data: Record<string, unknown>;
  readonly elm: Element;
  readonly children?: ReadonlyArray<FixtureVNode>;
  readonly key?: string | number;
};

const source = (
  file: string,
  view: string,
  line: number,
  column: number,
): AutomaticSource => ({
  file,
  view,
  line,
  column,
});

const node = (
  element: Element,
  children?: ReadonlyArray<FixtureVNode>,
  key?: string | number,
): FixtureVNode => ({
  sel: element.tagName.toLowerCase(),
  data: {},
  elm: element,
  ...(children === undefined ? {} : { children }),
  ...(key === undefined ? {} : { key }),
});

const flushCommit = async (): Promise<void> => {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
};

const contextFor = (element: Element) => {
  const context = automaticInspector.inspect(element, false);
  if (context === undefined) throw new Error('Missing automatic context');
  return context;
};

const resolveContext = (
  context: ReturnType<typeof contextFor>,
): Element | undefined => {
  if (automaticInspector.resolve === undefined)
    throw new Error('Missing context resolver');
  return automaticInspector.resolve(context);
};

beforeEach(() => {
  resetAutomaticContext();
  configureAutomaticContext([]);
  document.body.replaceChildren();
});

afterEach(() => {
  resetAutomaticContext();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('automatic FoldKit context observer', () => {
  it('carries ownership across FoldKit submodel root cloning and imported view metadata', async () => {
    const main = document.createElement('main');
    const button = document.createElement('button');
    main.append(button);
    document.body.append(main);
    const original = node(button);
    const childModel = { count: 2 };
    const childSource = source('src/child.ts', 'view', 8, 1);
    const childDefinition = source('src/child.ts', 'Model', 3, 1);
    const child = registerFunction(
      (model: typeof childModel) => {
        expect(model).toBe(childModel);
        return captureCall(() => original, undefined, [[]], childSource, 'element');
      },
      childSource,
      childDefinition,
    );
    const submodel = (config: {
      view: (model: unknown) => unknown;
      model: unknown;
    }) => {
      const result = config.view(config.model);
      if (typeof result !== 'object' || result === null)
        throw new Error('Expected a vnode');
      return { ...result };
    };
    const runtime = observeRuntime(
      {
        view: () => ({
          sel: 'main',
          data: {},
          elm: main,
          children: [
            captureCall(
              submodel,
              undefined,
              [{ slotId: 'child', model: childModel, view: child }],
              source('src/parent.ts', 'view', 20, 1),
              'submodel',
              { expression: 'model.child', file: 'src/parent.ts', line: 23, column: 9 },
            ),
          ],
        }),
      },
      source('src/parent.ts', 'view', 20, 1),
    );
    runtime.view();
    await flushCommit();
    const context = automaticInspector.inspect(button, true);
    expect(context?.source).toEqual(childSource);
    expect(context?.modelSource?.definition).toEqual(childDefinition);
    expect(context?.model).toEqual(childModel);
    expect(context?.boundary).toBe('src/parent.ts#view/child');
    expect(context === undefined ? undefined : resolveContext(context)).toBe(button);
  });

  it('maps a committed element to its registered view and model-supply sources', async () => {
    const ownerSource = source('src/counter.ts', 'counterView', 31, 1);
    const fallbackSource = source('src/generated.ts', 'wrappedView', 2, 3);
    const elementSource = source('src/counter.ts', 'counterView', 42, 7);
    const modelSource = {
      expression: 'model.counter',
      file: 'src/page.ts',
      line: 56,
      column: 12,
      definition: { file: 'src/counter.ts', view: 'Counter.Model', line: 8, column: 1 },
    };
    const rootElement = document.createElement('main');
    const button = document.createElement('button');
    rootElement.append(button);
    document.body.append(rootElement);
    const buttonVNode = node(button);
    const rootVNode = node(rootElement, [buttonVNode]);
    const callback = vi.fn();
    const elementBuilder = vi.fn(() => buttonVNode);
    const model = { count: 3 };
    const view = registerFunction(
      vi.fn((receivedModel: typeof model) => {
        expect(receivedModel).toBe(model);
        expect(
          captureCall(
            elementBuilder,
            undefined,
            [[{ _tag: 'OnClick', message: { _tag: 'Increment' }, callback }]],
            elementSource,
            'element',
          ),
        ).toBe(buttonVNode);
        return rootVNode;
      }),
      ownerSource,
    );
    const observed = observeRuntime({ view }, fallbackSource, modelSource);

    expect(observed.view(model)).toBe(rootVNode);
    expect(callback).not.toHaveBeenCalled();
    await flushCommit();

    const context = automaticInspector.inspect(button, false);
    expect(context).toMatchObject({
      provenance: 'automatic-instrumentation',
      boundary: 'src/counter.ts#counterView',
      source: ownerSource,
      elementSource,
      modelSource,
      events: [{ event: 'click', message: 'Increment' }],
    });
    expect(context?.model).toBeUndefined();
    expect(context?.instanceKey).toMatch(/^[-\w]+\|src\/counter\.ts#counterView\|$/);
  });

  it('serializes only the rendered scope after consent with redaction, safe accessors, cycles, and bounds', async () => {
    configureAutomaticContext(['excludedField']);
    const ownerSource = source('src/model.ts', 'modelView', 10, 1);
    const elementSource = source('src/model.ts', 'modelView', 12, 5);
    const rootElement = document.createElement('main');
    const button = document.createElement('button');
    rootElement.append(button);
    document.body.append(rootElement);
    const buttonVNode = node(button);
    const rootVNode = node(rootElement, [buttonVNode]);
    let getterCalls = 0;
    const model: Record<string, unknown> = {
      count: 3,
      password: 'do-not-share',
      excludedField: 'excluded',
      longText: 'x'.repeat(700),
      deep: {
        level1: { level2: { level3: { level4: { level5: { value: 'hidden' } } } } },
      },
    };
    model.circular = model;
    Object.defineProperty(model, 'lazyValue', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'must-not-run';
      },
    });
    const elementBuilder = vi.fn(() => buttonVNode);
    const view = (receivedModel: typeof model) => {
      expect(receivedModel).toBe(model);
      captureCall(elementBuilder, undefined, [[]], elementSource, 'element');
      return rootVNode;
    };
    const observed = observeRuntime({ view }, ownerSource);
    observed.view(model);
    await flushCommit();

    expect(automaticInspector.inspect(button, false)?.model).toBeUndefined();
    const included = automaticInspector.inspect(button, true)?.model;
    expect(included).toMatchObject({
      count: 3,
      password: '[redacted]',
      excludedField: '[redacted]',
      longText: 'x'.repeat(500),
      circular: '[circular]',
      lazyValue: '[accessor omitted]',
      deep: {
        level1: {
          level2: {
            level3: {
              level4: { level5: '[depth limit]' },
            },
          },
        },
      },
    });
    expect(getterCalls).toBe(0);
  });

  it('keeps submodel and slot ownership separate while preserving VNode and Model references', async () => {
    const parentSource = source('src/page.ts', 'pageView', 20, 1);
    const childViewSource = source('src/counter.ts', 'counterView', 31, 1);
    const childElementSource = source('src/counter.ts', 'counterView', 42, 7);
    const slotElementSource = source('src/page.ts', 'pageView', 55, 9);
    const parentModel = { counter: { count: 3 } };
    const childModel = parentModel.counter;
    const childModelSource = {
      expression: 'model.counter',
      file: 'src/page.ts',
      line: 56,
      column: 12,
    };
    const rootElement = document.createElement('main');
    const childElement = document.createElement('button');
    const slotElement = document.createElement('a');
    rootElement.append(childElement, slotElement);
    document.body.append(rootElement);
    const childVNode = node(childElement);
    const slotVNode = node(slotElement);
    const rootVNode = node(rootElement, [childVNode, slotVNode]);
    const childBuilder = vi.fn(() => childVNode);
    const slotBuilder = vi.fn(() => slotVNode);
    const childView = registerFunction(
      vi.fn((receivedModel: typeof childModel) => {
        expect(receivedModel).toBe(childModel);
        return captureCall(
          childBuilder,
          undefined,
          [[]],
          childElementSource,
          'element',
        );
      }),
      childViewSource,
    );
    const slot = () =>
      captureCall(slotBuilder, undefined, [[]], slotElementSource, 'element');
    const submodelBuilder = vi.fn(
      (config: {
        readonly model: unknown;
        readonly view: (model: unknown) => unknown;
        readonly viewInputs?: Readonly<{ slot?: () => unknown }>;
      }) => {
        const renderedChild = config.view(config.model);
        const renderedSlot = config.viewInputs?.slot?.();
        expect(config.model).toBe(childModel);
        expect(renderedChild).toBe(childVNode);
        expect(renderedSlot).toBe(slotVNode);
        return rootVNode;
      },
    );
    const parentView = registerFunction(
      vi.fn((receivedModel: typeof parentModel) => {
        expect(receivedModel).toBe(parentModel);
        return captureCall(
          submodelBuilder,
          undefined,
          [
            {
              slotId: 'primary-counter',
              model: childModel,
              view: childView,
              viewInputs: { slot },
            },
          ],
          parentSource,
          'submodel',
          childModelSource,
        );
      }),
      parentSource,
    );
    const observed = observeRuntime({ view: parentView }, parentSource);

    expect(observed.view(parentModel)).toBe(rootVNode);
    await flushCommit();

    const childContext = contextFor(childElement);
    expect(childContext).toMatchObject({
      source: childViewSource,
      elementSource: childElementSource,
      boundary: 'src/page.ts#pageView/primary-counter',
      modelSource: childModelSource,
    });
    const slotContext = contextFor(slotElement);
    expect(slotContext).toMatchObject({
      source: parentSource,
      elementSource: slotElementSource,
      boundary: 'src/page.ts#pageView',
    });
    expect(slotContext.source).not.toEqual(childViewSource);
  });

  it('reattaches keyed repeated elements uniquely but refuses ambiguous unkeyed matches', async () => {
    const ownerSource = source('src/list.ts', 'listView', 10, 1);
    const elementSource = source('src/list.ts', 'listView', 14, 5);
    const render = async (keys: ReadonlyArray<string | number | undefined>) => {
      resetAutomaticContext();
      document.body.replaceChildren();
      const rootElement = document.createElement('ul');
      const buttons = keys.map(() => document.createElement('button'));
      rootElement.append(...buttons);
      document.body.append(rootElement);
      const vnodes = buttons.map((button, index) =>
        node(button, undefined, keys[index]),
      );
      const builders = vnodes.map((vnode) => vi.fn(() => vnode));
      const view = (model: unknown) => {
        const children = vnodes.map((vnode, index) => {
          const captured = captureCall(
            builders[index],
            undefined,
            [[]],
            elementSource,
            'element',
          );
          expect(captured).toBe(vnode);
          return vnode;
        });
        expect(model).toEqual({});
        return node(rootElement, children);
      };
      const observed = observeRuntime({ view }, ownerSource);
      observed.view({});
      await flushCommit();
      return { buttons, contexts: buttons.map(contextFor) };
    };

    const keyed = await render(['first', 'second']);
    expect(keyed.contexts[0]?.instanceKey).not.toBe(keyed.contexts[1]?.instanceKey);
    expect(resolveContext(keyed.contexts[0]!)).toBe(keyed.buttons[0]);
    expect(resolveContext(keyed.contexts[1]!)).toBe(keyed.buttons[1]);

    const unkeyed = await render([undefined, undefined]);
    expect(unkeyed.contexts[0]?.instanceKey).toBe(unkeyed.contexts[1]?.instanceKey);
    expect(resolveContext(unkeyed.contexts[0]!)).toBeUndefined();
  });

  it('drops disconnected and reset runtimes and allows subscribers to clean up', async () => {
    const ownerSource = source('src/disconnect.ts', 'view', 1, 1);
    const elementSource = source('src/disconnect.ts', 'view', 2, 3);
    const rootElement = document.createElement('main');
    const button = document.createElement('button');
    rootElement.append(button);
    document.body.append(rootElement);
    const buttonVNode = node(button);
    const rootVNode = node(rootElement, [buttonVNode]);
    const builder = vi.fn(() => buttonVNode);
    const view = () => {
      captureCall(builder, undefined, [[]], elementSource, 'element');
      return rootVNode;
    };
    const observed = observeRuntime({ view }, ownerSource);
    let notifications = 0;
    const unsubscribe = automaticInspector.subscribe(() => {
      notifications += 1;
    });

    observed.view();
    await flushCommit();
    const context = contextFor(button);
    expect(notifications).toBe(1);
    button.remove();
    expect(automaticInspector.inspect(button, false)).toBeUndefined();
    expect(resolveContext(context)).toBeUndefined();

    unsubscribe();
    resetAutomaticContext();
    expect(automaticInspector.inspect(button, false)).toBeUndefined();
    expect(resolveContext(context)).toBeUndefined();
    expect(notifications).toBe(1);
  });
});
