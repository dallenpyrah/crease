import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type AutomaticSourceReference,
  transformAutomaticContext,
} from './automatic-transform';
import {
  MAX_SOURCE_CONTEXT_BATCH,
  MAX_SOURCE_SNIPPET_CHARS,
  SourceEvidenceRegistry,
  decodeSourceContextRequest,
} from './source-evidence';

const roots: Array<string> = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('SourceEvidenceRegistry', () => {
  it('reports a reassigned style alias as unsupported rather than choosing its initializer', async () => {
    const root = await project();
    const path = join(root, 'src/main.ts');
    const code = `import * as stylex from '@stylexjs/stylex';
import { Runtime } from 'foldkit';
const Model = {};
const styles = stylex.create({ first: { padding: 8 }, second: { padding: 16 } });
let active = styles.first;
active = styles.second;
const view = (model, h) => h.button([h.Class(stylex.props(active).className)], []);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    await writeFile(path, code);
    const transformed = enriched(code, path, root);
    const button = attributeReference(transformed.sourceReferences, code, 'h.button');
    const registry = new SourceEvidenceRegistry(root);
    registry.registerTransform(path, code, transformed.sourceReferences);
    const [evidence] = await registry.sources([button.source]);
    expect(evidence?.styles?.[0]).toMatchObject({
      expression: 'active',
      reason: 'mutable style bindings are not resolved statically',
    });
    expect(evidence?.styles?.[0]?.definition).toBeUndefined();
  });

  it('returns bounded literal evidence and imported StyleX candidate provenance', async () => {
    const root = await project();
    const stylesPath = join(root, 'src/styles.ts');
    const mainPath = join(root, 'src/main.ts');
    await writeFile(
      stylesPath,
      `import { create as makeStyles } from '@stylexjs/stylex';
const sheet = makeStyles({
  base: { color: 'navy', padding: 8 },
  active: { color: 'green' },
});
export const styles = sheet;`,
    );
    const code = `import * as stylex from '@stylexjs/stylex';
import { Runtime } from 'foldkit';
import { styles } from './styles';
const Model = {};
const css = (...values) => stylex.props(...values).className ?? '';
const activeStyle = styles.active;
const dynamicStyle = (model) => model.style;
const view = (model, h) => h.button([
  h.Class(css([styles.base, model.active && activeStyle], dynamicStyle(model))),
  h.Data('config', { password: 'must-not-leak' }),
], [h.span([], [model.privateText])]);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
    await writeFile(mainPath, code);

    const transformed = enriched(code, mainPath, root);
    const button = attributeReference(transformed.sourceReferences, code, 'h.button');
    const registry = new SourceEvidenceRegistry(root);
    registry.setResolver(async (specifier, importer) =>
      specifier === './styles' ? resolve(dirname(importer), 'styles.ts') : undefined,
    );
    registry.registerTransform(mainPath, code, transformed.sourceReferences);

    const [evidence] = await registry.sources([button.source]);
    expect(evidence).toMatchObject({ status: 'current', snippetTruncated: true });
    expect(evidence?.snippet).toContain('h.button([');
    expect(evidence?.snippet).toContain('[REDACTED credential-shaped literal]');
    expect(evidence?.snippet).not.toContain('must-not-leak');
    expect(evidence?.snippet).not.toContain('privateText');
    expect(evidence?.snippet?.length).toBeLessThanOrEqual(MAX_SOURCE_SNIPPET_CHARS);

    expect(evidence?.styles?.map((style) => style.expression)).toEqual([
      'styles.base',
      'activeStyle',
      'dynamicStyle(…)',
    ]);
    expect(evidence?.styles?.[0]?.definition).toMatchObject({
      file: 'src/styles.ts',
      status: 'current',
    });
    expect(evidence?.styles?.[0]?.definition?.snippet).toContain(
      "base: { color: 'navy', padding: 8 }",
    );
    expect(evidence?.styles?.[1]?.definition?.snippet).toContain(
      "active: { color: 'green' }",
    );
    expect(evidence?.styles?.[2]?.reason).toBe('unsupported dynamic style expression');
  });

  it('retains bounded validated history so an old capture becomes stale after HMR', async () => {
    const root = await project();
    const mainPath = join(root, 'src/main.ts');
    const first = application("h.button([], ['first'])");
    await writeFile(mainPath, first);
    const firstTransform = enriched(first, mainPath, root);
    const firstButton = attributeReference(
      firstTransform.sourceReferences,
      first,
      'h.button',
    );
    const registry = new SourceEvidenceRegistry(root);
    registry.registerTransform(mainPath, first, firstTransform.sourceReferences);

    const second = application("h.button([], ['second version'])");
    await writeFile(mainPath, second);
    const secondTransform = enriched(second, mainPath, root);
    const secondButton = attributeReference(
      secondTransform.sourceReferences,
      second,
      'h.button',
    );
    registry.registerTransform(mainPath, second, secondTransform.sourceReferences);

    const [stale, current] = await registry.sources([
      firstButton.source,
      secondButton.source,
    ]);
    expect(stale).toMatchObject({ status: 'stale', snippetTruncated: false });
    expect(stale?.snippet).toBeUndefined();
    expect(current).toMatchObject({ status: 'current' });
    expect(current?.snippet).toContain('h.button([]');
    expect(current?.snippet).not.toContain('second version');
  });

  it('refuses unproven transform input, credential files, symlink escapes, and arbitrary refs', async () => {
    const root = await project();
    const mainPath = join(root, 'src/main.ts');
    const disk = application("h.button([], ['disk'])");
    const priorTransformInput = `${disk}\n// changed by an earlier transform`;
    await writeFile(mainPath, disk);
    const prior = enriched(priorTransformInput, mainPath, root);
    const priorButton = attributeReference(
      prior.sourceReferences,
      priorTransformInput,
      'h.button',
    );
    const registry = new SourceEvidenceRegistry(root);
    registry.registerTransform(mainPath, priorTransformInput, prior.sourceReferences);
    expect((await registry.sources([priorButton.source]))[0]).toMatchObject({
      status: 'unavailable',
    });

    const credentialPath = join(root, 'src/secrets.ts');
    await writeFile(credentialPath, disk);
    const credential = enriched(disk, credentialPath, root);
    registry.registerTransform(credentialPath, disk, credential.sourceReferences);
    expect(
      (await registry.sources([credential.sourceReferences[0]!.source]))[0],
    ).toMatchObject({ status: 'unavailable' });

    const outside = await mkdtemp(join(tmpdir(), 'creasekit-source-outside-'));
    roots.push(outside);
    const outsidePath = join(outside, 'escaped.ts');
    await writeFile(outsidePath, disk);
    const linkPath = join(root, 'src/linked.ts');
    await symlink(outsidePath, linkPath);
    const linked = enriched(disk, linkPath, root);
    registry.registerTransform(linkPath, disk, linked.sourceReferences);
    expect(
      (await registry.sources([linked.sourceReferences[0]!.source]))[0],
    ).toMatchObject({
      status: 'unavailable',
    });

    expect(() =>
      decodeSourceContextRequest({
        sources: [{ file: '../.env', view: 'view' }],
      }),
    ).toThrow();
    expect(() =>
      decodeSourceContextRequest({
        sources: Array.from({ length: MAX_SOURCE_CONTEXT_BATCH + 1 }, () => ({
          file: 'src/main.ts',
          view: 'view',
        })),
      }),
    ).toThrow();
  });
});

const project = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'creasekit-source-evidence-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  return root;
};

const application = (body: string): string => `import { Runtime } from 'foldkit';
const Model = {};
const view = (model, h) => ${body};
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;

const enriched = (code: string, id: string, root: string) => {
  const result = transformAutomaticContext(code, id, root, { sourceEvidence: true });
  if (result === null) throw new Error('Expected automatic transform');
  return result;
};

const attributeReference = (
  references: ReadonlyArray<AutomaticSourceReference>,
  code: string,
  prefix: string,
): AutomaticSourceReference => {
  const reference = references.find(
    (candidate) =>
      candidate.attributesStart !== undefined &&
      code.slice(candidate.start, candidate.start + prefix.length) === prefix,
  );
  if (reference === undefined) throw new Error(`Missing ${prefix} source reference`);
  return reference;
};
