import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { transformAutomaticContext } from './automatic-transform';

const ROOT = '/workspace/source-evidence-app';

describe('automatic source evidence transform', () => {
  it('adds original end-exclusive spans and revision only on the Vite evidence path', () => {
    const code = `import { Runtime } from 'foldkit';
const Model = {};
const row = (model, h) => h.button([h.Class(model.className)], [model.label]);
const view = (model, h) => h.main([], [row(model, h)]);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    const id = `${ROOT}/src/main.ts`;
    const revision = createHash('sha256').update(code).digest('hex');
    const legacy = transformAutomaticContext(code, id, ROOT);
    const enriched = transformAutomaticContext(code, id, ROOT, {
      sourceEvidence: true,
    });

    expect(legacy?.code).not.toContain('"revision"');
    expect(enriched?.code).toContain(`"revision":"${revision}"`);
    expect(enriched?.code).toContain(',"helper")');
    const button = enriched?.sourceReferences.find(
      (reference) =>
        reference.source.line === 3 && reference.attributesStart !== undefined,
    );
    expect(button?.source).toMatchObject({
      file: 'src/main.ts',
      view: 'row',
      line: 3,
      column: 27,
      endLine: 3,
      revision,
    });
    expect(button?.source.endColumn).toBeGreaterThan(button?.source.column ?? 0);
    expect(code.slice(button?.snippetStart, button?.snippetEnd)).toBe(
      'h.button([h.Class(model.className)]',
    );
    expect(code.slice(button?.snippetStart, button?.snippetEnd)).not.toContain(
      'model.label',
    );
    expect(button?.snippetTruncated).toBe(true);
  });

  it('captures only binding-proven local HTML helpers, not attribute or arbitrary calls', () => {
    const code = `import { Runtime } from 'foldkit';
const Model = {};
const classAttr = (h, value) => h.Class(value);
const card = (h, text) => h.article([classAttr(h, format(text))], [text]);
const format = (value) => String(value);
const view = (model, h) => h.main([], [card(h, model.title)]);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    const result = transformAutomaticContext(code, `${ROOT}/src/helpers.ts`, ROOT, {
      sourceEvidence: true,
    });

    expect(result?.code.match(/,"helper"\)/gu)).toHaveLength(1);
    expect(result?.code).toContain('card,void 0,[');
    expect(result?.code).not.toContain('classAttr,void 0,[');
    expect(result?.code).not.toContain('format,void 0,[');
  });
});
