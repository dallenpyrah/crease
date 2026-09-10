import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

import {
  type AutomaticTransformResult,
  transformAutomaticContext,
} from './automatic-transform';

const ROOT = '/workspace/foldkit-app';

const transform = (code: string, file = 'src/main.ts'): AutomaticTransformResult => {
  const result = transformAutomaticContext(code, `${ROOT}/${file}`, ROOT);
  if (result === null) throw new Error(`Expected ${file} to be transformed`);
  return result;
};

const captureCount = (code: string): number =>
  code.match(/\b__creasekitCaptureCall(?:_\d+)?\(/gu)?.length ?? 0;

describe('transformAutomaticContext', () => {
  it('parses TypeScript and JSX and instruments aliased root views at original positions', () => {
    const code = `import { Runtime as FoldRuntime } from 'foldkit';
import type { HtmlBuilder as Builder } from 'foldkit/html';

type Message = { readonly _tag: string };
const Model = {};
const badge = (h: Builder<Message>) => <aside>{h.span([], ['new'])}</aside>;
export const page = (model: unknown, h: Builder<Message>) => ({
  body: h.main([], [badge(h)]),
});

FoldRuntime.makeElement({ Model, view: page, init() {}, update() {}, container: null });`;
    const result = transform(code, 'src/page.tsx');

    expect(captureCount(result.code)).toBe(2);
    expect(result.code).toContain(
      '"file":"src/page.tsx","view":"badge","line":6,"column":48',
    );
    expect(result.code).toContain(
      '"file":"src/page.tsx","view":"page","line":8,"column":9',
    );
    expect(result.code).toContain('__creasekitRegisterFunction(badge,');
    expect(result.code).toContain('__creasekitRegisterFunction(page,');
    expect(result.code).toContain('FoldRuntime.makeElement(__creasekitObserveRuntime(');
    expect(() =>
      parse(result.code, {
        plugins: ['typescript', 'jsx'],
        sourceType: 'module',
      }),
    ).not.toThrow();
  });

  it('supports foldkit namespaces and direct runtime entry aliases', () => {
    const namespace = transform(`import * as Foldkit from 'foldkit';
const Model = {};
function render(model, h) { return h.section([], []); }
Foldkit.Runtime.makeApplication({ Model, view: render, init() {}, update() {}, container: null });`);
    const direct =
      transform(`import { makeElement as createRuntime } from 'foldkit/runtime';
const Model = {};
const render = (model, h) => h.article([], []);
const config = { Model, view: render, init() {}, update() {}, container: null };
{ const render = () => null; createRuntime(config); }`);

    expect(captureCount(namespace.code)).toBe(1);
    expect(namespace.code).toContain(
      'Foldkit.Runtime.makeApplication(__creasekitObserveRuntime(',
    );
    expect(namespace.code).toContain('__creasekitRegisterFunction(render,');
    expect(captureCount(direct.code)).toBe(1);
    expect(direct.code).toContain('createRuntime(__creasekitObserveRuntime(');
    expect(direct.code).toContain('"view":"render"');
  });

  it('captures the packed consumer fixture root and button call sites', () => {
    const root = resolve('scripts/fixtures/foldkit-app');
    const id = resolve(root, 'src/main.ts');
    const result = transformAutomaticContext(readFileSync(id, 'utf8'), id, root);
    if (result === null) throw new Error('Expected the packed consumer to transform');

    expect(captureCount(result.code)).toBe(7);
    expect(result.code).toContain('__creasekitCaptureCall(h.main,h,[');
    expect(result.code.match(/__creasekitCaptureCall\(h\.button,h,/gu)).toHaveLength(2);
    expect(result.code).toContain(
      '"file":"src/main.ts","view":"view","line":29,"column":7',
    );
    expect(result.code).toContain(
      '__creasekitRegisterFunction(view,{"file":"src/main.ts","view":"view","line":21,"column":1},{"file":"src/main.ts","view":"Model","line":6,"column":1})',
    );
  });

  it('instruments typed helpers, defineView submodels, keyed builders, and Model supply sites', () => {
    const code = `import { Runtime } from 'foldkit';
import type { HtmlBuilder } from 'foldkit/html';
import { defineView as child } from 'foldkit/submodel';

type ChildModel = { readonly count: number };
type Message = { readonly _tag: string };
const Model = {};
const helper = (h: HtmlBuilder<Message>) => h.span([], ['helper']);
export const counterView = child<ChildModel, Message>((model, h) =>
  h.button([], [String(model.count)]),
);
const view = (model: { child: ChildModel }, h: HtmlBuilder<Message>) =>
  h.main([], [
    helper(h),
    h.keyed('li')(model.child.count, [], []),
    h.submodel({
      slotId: 'counter',
      model: model.child,
      view: counterView,
      toParentMessage: (message) => message,
    }),
  ]);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    const result = transform(code);

    expect(captureCount(result.code)).toBe(5);
    expect(result.code).toContain('__creasekitRegisterFunction(counterView,');
    expect(result.code).toContain(
      '__creasekitRegisterFunction(counterView,{"file":"src/main.ts","view":"counterView","line":9,"column":1},{"file":"src/main.ts","view":"ChildModel","line":5,"column":1})',
    );
    expect(result.code).toContain('__creasekitRegisterFunction(helper,');
    expect(result.code).toContain("__creasekitCaptureCall(h.keyed('li'),void 0,[");
    expect(result.code).toContain('"expression":"model.child"');
    expect(result.code).toContain(
      '"definition":{"file":"src/main.ts","view":"ChildModel","line":5,"column":1}',
    );
    expect(result.code).toContain(',"submodel",{"expression":"model.child"');
  });

  it('does not capture shadowed builders, runtimes, or unrelated lookalikes', () => {
    const code = `import { Runtime } from 'foldkit';
import type { HtmlBuilder } from 'foldkit/html';
const Model = {};
const other = { div() {}, button() {}, span() {} };
const view = (model: unknown, h: HtmlBuilder<never>) => {
  const owned = h.div([], []);
  function nested(h: typeof other) { return h.button(); }
  { const h = other; h.span(); }
  (() => h.button([], []))();
  return [owned, nested(other)];
};
function falseRuntime(Runtime: { makeApplication(value: unknown): unknown }) {
  return Runtime.makeApplication({ view, Model });
}
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    const result = transform(code);

    expect(captureCount(result.code)).toBe(2);
    expect(result.code).toContain('const owned = __creasekitCaptureCall(h.div,h,[');
    expect(result.code).toContain('(() => __creasekitCaptureCall(h.button,h,[');
    expect(result.code).toContain('return h.button();');
    expect(result.code).toContain('{ const h = other; h.span(); }');
    expect(result.code.match(/__creasekitObserveRuntime\(/gu)?.length).toBe(1);
    const unrelated = transformAutomaticContext(
      `import { Runtime } from './runtime';
const view = (model, h) => h.button([], []);
Runtime.makeApplication({ view });`,
      `${ROOT}/src/unrelated.js`,
      ROOT,
    );
    expect(unrelated).toBeNull();
  });

  it('preserves function, Model, VNode, receiver, keyed, and argument semantics', () => {
    const source = `import { Runtime as FoldRuntime } from 'foldkit';
const Model = { schema: true };
const directVNode = { key: 'direct' };
const keyedVNode = { key: 'keyed' };
const mark = (value) => { hooks.order.push(value); return value; };
const builder = {
  get button() {
    hooks.order.push('get-button');
    return function (first, second) {
      hooks.directThis = this;
      hooks.directArgs = [first, second];
      return directVNode;
    };
  },
  keyed(tag) {
    hooks.order.push('keyed-' + tag);
    hooks.keyedFactoryThis = this;
    return function (key) {
      hooks.keyedThis = this;
      hooks.keyedArg = key;
      return keyedVNode;
    };
  },
};
const view = (model, h) => [
  h.button(mark('first'), mark('second')),
  h.keyed(mark('li'))(mark('key')),
];
const originalView = view;
const application = FoldRuntime.makeApplication({ Model, view, init() {}, update() {}, container: null });
hooks.sameView = application.view === originalView;
hooks.sameModel = application.Model === Model;
const rendered = application.view({}, builder);
hooks.sameDirectVNode = rendered[0] === directVNode;
hooks.sameKeyedVNode = rendered[1] === keyedVNode;`;
    const result = transform(source, 'src/runtime.js');
    const hooks = execute(result.code);

    expect(hooks.sameView).toBe(true);
    expect(hooks.sameModel).toBe(true);
    expect(hooks.sameDirectVNode).toBe(true);
    expect(hooks.sameKeyedVNode).toBe(true);
    expect(hooks.directThis).toBe(hooks.builder);
    expect(hooks.keyedFactoryThis).toBe(hooks.builder);
    expect(hooks.keyedThis).toBeUndefined();
    expect(hooks.directArgs).toEqual(['first', 'second']);
    expect(hooks.keyedArg).toBe('key');
    expect(hooks.order).toEqual([
      'get-button',
      'first',
      'second',
      'li',
      'keyed-li',
      'key',
    ]);
    expect(hooks.registeredValues).toContain(hooks.originalView);
  });

  it('keeps Model expressions private and omits unresolved imported definitions', () => {
    const imported = transform(
      `import { Runtime } from 'foldkit';
import { Model, init, update, view } from './main';
Runtime.makeApplication({ Model, init, update, view, container: null });`,
      'src/entry.ts',
    );
    expect(imported.code).toContain('"expression":"Model"');
    expect(imported.code).not.toContain('"definition"');

    const computed = transform(`import { Runtime } from 'foldkit';
const Model = {};
const childView = (model, h) => h.button([], []);
const view = (model, h) => h.submodel({
  slotId: 'child',
  model: deriveChild({ password: 'never-copy-this' }),
  view: childView,
  toParentMessage: (message) => message,
});
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`);
    expect(computed.code).toContain('"expression":"deriveChild(…)"');
    expect(computed.code).not.toContain(
      '"expression":"deriveChild({ password: \'never-copy-this\' })"',
    );

    const callback = transform(
      `import { Runtime } from 'foldkit';
import * as Counter from './counter';
const Model = {};
const view = (model, h) => model.items.map((item) => h.submodel({
  slotId: item.id,
  model: item,
  view: Counter.view,
  toParentMessage: (message) => message,
}));
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`,
      'src/instances.ts',
    );
    const itemSource = /\{"expression":"item"[^}]*\}/u.exec(callback.code)?.[0];
    expect(itemSource).toBeDefined();
    expect(itemSource).not.toContain('definition');
  });

  it('uses collision-safe helper imports and preserves directive prologues', () => {
    const result = transform(
      `'use client';
import { Runtime } from 'foldkit';
const __creasekitRegisterFunction = 1;
const __creasekitCaptureCall = 2;
const Model = {};
const view = (model, h) => h.div([], []);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`,
      'src/collisions.js',
    );

    expect(result.code).toMatch(/^'use client';\nimport \{/u);
    expect(result.code).toContain('registerFunction as __creasekitRegisterFunction_1');
    expect(result.code).toContain('captureCall as __creasekitCaptureCall_1');
    expect(result.code).toContain('__creasekitCaptureCall_1(h.div,h,[');
  });

  it('returns high-resolution maps with original content', () => {
    const code = `import { Runtime } from 'foldkit';
const Model = {};
const view = (model, h) => h.button([], []);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    const result = transform(code, 'src/maps.js');

    expect(result.map.version).toBe(3);
    expect(result.map.sourcesContent).toEqual([code]);
    expect(result.map.sources).toEqual(['maps.js']);
    expect(result.map.mappings.length).toBeGreaterThan(0);
  });

  it('skips virtual, dependency, outside-root, unsupported, and creasekit library files', () => {
    const code = `import { Runtime } from 'foldkit';
const view = (model, h) => h.div([], []);
Runtime.makeApplication({ Model: {}, view });`;
    const ids = [
      'virtual:creasekit-runtime',
      '\0virtual:creasekit-runtime',
      `${ROOT}/node_modules/example/index.js`,
      '/workspace/outside.js',
      `${ROOT}/src/style.css`,
      `${ROOT}/src/types.d.ts`,
      `${ROOT}/src/main.ts?raw`,
    ];
    for (const id of ids) {
      expect(transformAutomaticContext(code, id, ROOT), id).toBeNull();
    }

    expect(
      transformAutomaticContext(code, resolve('server/vite-plugin.ts'), resolve('.')),
    ).toBeNull();
    expect(
      transformAutomaticContext(code, resolve('src/main.ts'), resolve('.')),
    ).not.toBeNull();
  });
});

interface ExecutionHooks extends Record<string, unknown> {
  application?: Record<string, unknown>;
  builder?: unknown;
  order: Array<string>;
  originalView?: unknown;
  registeredValues: Array<unknown>;
}

const execute = (generated: string): ExecutionHooks => {
  const hooks: ExecutionHooks = { order: [], registeredValues: [] };
  const virtualImport = /import \{ ([^}]+) \} from "virtual:creasekit-runtime";/u;
  const match = virtualImport.exec(generated);
  const specifiers = match?.[1];
  if (match === null || specifiers === undefined) {
    throw new Error('Missing virtual runtime import');
  }
  const declarations = specifiers.split(',').map((specifier) => {
    const parts = /^\s*(\w+) as (\w+)\s*$/u.exec(specifier);
    const exported = parts?.[1];
    const local = parts?.[2];
    if (exported === undefined || local === undefined) {
      throw new Error(`Unexpected virtual import specifier: ${specifier}`);
    }
    return `const ${local} = hooks.${exported};`;
  });
  const executable = generated
    .replace(virtualImport, declarations.join('\n'))
    .replace(
      "import { Runtime as FoldRuntime } from 'foldkit';",
      'const FoldRuntime = hooks.Runtime;',
    );

  hooks.registerFunction = (value: unknown): unknown => {
    hooks.registeredValues.push(value);
    hooks.originalView ??= value;
    return value;
  };
  hooks.observeRuntime = (config: unknown): unknown => config;
  hooks.captureCall = (
    fn: unknown,
    receiver: unknown,
    args: ReadonlyArray<unknown>,
  ): unknown => {
    if (typeof fn !== 'function') throw new TypeError('Expected a function');
    return Reflect.apply(fn, receiver, args);
  };
  hooks.Runtime = {
    makeApplication(config: Record<string, unknown>) {
      hooks.application = config;
      return config;
    },
  };
  hooks.builder = runInNewContext(`"use strict";\n${executable}\nbuilder`, { hooks });
  return hooks;
};
