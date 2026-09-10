import { Effect, Schema } from 'effect';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Annotation, AnnotationArray } from './domain';
import { formatJson, formatMarkdown } from './export';
import { withoutModel } from './foldkit-context';
import type { FoldkitContext } from './foldkit-schema';
import { makeLocalPersistence } from './persistence';

const context: FoldkitContext = {
  provenance: 'automatic-instrumentation',
  source: { file: 'src/counter.ts', view: 'counterView', line: 20, column: 1 },
  elementSource: { file: 'src/counter.ts', view: 'counterView', line: 24, column: 5 },
  modelSource: {
    expression: 'model.counter',
    file: 'src/page.ts',
    line: 42,
    column: 9,
    definition: { file: 'src/counter.ts', view: 'Model', line: 3, column: 1 },
  },
  boundary: 'page/primary-counter',
  instanceKey: 'runtime|page/primary-counter|"item-1"',
  events: [{ event: 'click', message: 'ClickedIncrement' }],
  model: { count: 3 },
  availability: ['Rendered scope, not inferred state dependencies.'],
  capturedAt: 1,
};

const annotation: Annotation = {
  version: 1,
  id: 'automatic-note',
  comment: 'Add spacing',
  status: 'open',
  target: {
    tag: 'button',
    selector: '#counter',
    role: 'button',
    text: 'Increment',
    classes: '',
    url: 'http://127.0.0.1:4173/',
    bounds: { x: 0, y: 0, width: 100, height: 30 },
    styles: {
      display: 'block',
      position: 'static',
      fontFamily: 'sans-serif',
      fontSize: '16px',
      lineHeight: '20px',
      color: 'black',
      backgroundColor: 'white',
      margin: '0',
      padding: '0',
      gap: '0',
    },
  },
  capture: {
    viewportWidth: 1000,
    viewportHeight: 800,
    scrollX: 0,
    scrollY: 0,
    capturedAt: 1,
  },
  createdAt: 1,
  updatedAt: 1,
  foldkit: context,
};

beforeEach(() => vi.stubGlobal('localStorage', new Storage()));
afterEach(() => vi.unstubAllGlobals());

describe('automatic annotation contract', () => {
  it('retains distinct source locations and provenance through JSON and Markdown', () => {
    const decoded = Schema.decodeUnknownSync(AnnotationArray)(
      JSON.parse(formatJson([annotation])),
    );
    expect(decoded[0]?.foldkit).toEqual(context);
    const markdown = formatMarkdown(decoded);
    expect(markdown).toContain('automatic instrumentation');
    expect(markdown).toContain('**Element source:** src/counter.ts:24:5');
    expect(markdown).toContain('**Source:** src/counter.ts:20:1 → counterView');
    expect(markdown).toContain('**Model declaration:** Model (src/counter.ts:3:1)');
    expect(markdown).toContain('model.counter (src/page.ts:42:9)');
    expect(markdown).not.toContain('explicit registration');
  });

  it('preserves automatic metadata but removes consented state from persistence', () => {
    const persistence = makeLocalPersistence('automatic-contract');
    Effect.runSync(persistence.save([annotation]));
    const saved = Effect.runSync(persistence.load)[0]?.foldkit;
    expect(saved).toEqual(withoutModel(context));
    expect(saved?.model).toBeUndefined();
    expect(saved?.modelSource?.definition?.file).toBe('src/counter.ts');
    expect(saved?.instanceKey).toBe(context.instanceKey);
  });

  it('continues decoding explicit v1 annotations without automatic fields', () => {
    const oldContext = {
      provenance: 'explicit-registration',
      source: context.source,
      boundary: context.boundary,
      events: context.events,
      capturedAt: 1,
    };
    const decoded = Schema.decodeUnknownSync(AnnotationArray)([
      { ...annotation, foldkit: oldContext },
    ]);
    expect(decoded[0]?.foldkit).toEqual(oldContext);
  });
});
