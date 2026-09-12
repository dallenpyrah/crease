import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Schema } from 'effect';
import type { SourceEvidence } from '../src/source-schema.js';
import { SourceEvidence as SourceEvidenceSchema } from '../src/source-schema.js';
import { afterEach, describe, expect, it } from 'vitest';

import { homepageSourceDemo } from './homepage-source-plugin';

const roots: Array<string> = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('homepageSourceDemo', () => {
  it('precomputes original evidence with redacted snippets and allowlisted styles', async () => {
    const project = await createProject();
    const prepared = await prepare(project.root);
    const manifest = await loadManifest(prepared.plugin, prepared.context);
    const main = manifest.find(
      (source) => source.file === 'src/main.ts' && source.snippet?.includes('h.button'),
    );

    expect(prepared.plugin.apply).toBe('build');
    expect(prepared.plugin.enforce).toBe('pre');
    expect(transformOrder(prepared.plugin)).toBe('pre');
    expect(main).toMatchObject({
      file: 'src/main.ts',
      view: 'view',
      line: expect.any(Number),
      endLine: expect.any(Number),
      revision: createHash('sha256').update(project.main).digest('hex'),
      status: 'current',
    });
    expect(main?.snippet).toContain('h.button');
    expect(main?.snippet).toContain('[REDACTED credential-shaped literal]');
    expect(main?.snippet).not.toContain('must-not-leak');
    expect(
      manifest.every(
        (source) => source.status === 'current' && source.snippet !== undefined,
      ),
    ).toBe(true);
    expect(main?.styles).toContainEqual(
      expect.objectContaining({
        expression: 'styles.primary',
        definition: expect.objectContaining({
          file: 'src/styles.ts',
          snippet: expect.stringContaining("color: 'red'"),
          status: 'current',
        }),
      }),
    );

    expect(manifest.some((source) => source.view === 'Model')).toBe(false);
    expect(
      manifest
        .flatMap((source) => source.styles ?? [])
        .some((style) => style.definition?.file === 'src/private.ts'),
    ).toBe(false);
  });

  it('excludes non-homepage modules from instrumentation and the manifest', async () => {
    const project = await createProject();
    const prepared = await prepare(project.root);
    const transformed = await transform(
      prepared.plugin,
      prepared.context,
      project.private,
      join(project.root, 'src/private.ts'),
    );
    const manifestModule = await loadManifestModule(prepared.plugin, prepared.context);

    expect(transformed).toBeUndefined();
    expect(manifestModule).not.toContain('src/private.ts');
    expect(manifestModule).not.toContain('private-source-should-not-appear');
  });

  it('fails closed when an earlier transform changes captured input', async () => {
    const project = await createProject();
    const prepared = await prepare(project.root);
    const id = join(project.root, 'src/main.ts');

    await expect(
      transform(
        prepared.plugin,
        prepared.context,
        `${project.main}\n// earlier transform`,
        id,
      ),
    ).rejects.toThrow('no longer matches its original source');

    const transformed = await transform(
      prepared.plugin,
      prepared.context,
      project.main,
      id,
    );
    if (typeof transformed !== 'object' || transformed === null) {
      throw new Error('Expected precomputed transform result');
    }
    const code = transformed.code;
    if (typeof code !== 'string') throw new Error('Expected transformed source code');
    expect(code).toContain('virtual:creasekit-runtime');
  });

  it('does not serialize private paths, credentials, model state, or an endpoint', async () => {
    const project = await createProject();
    const prepared = await prepare(project.root);
    const manifestModule = await loadManifestModule(prepared.plugin, prepared.context);

    expect(manifestModule).not.toContain(project.root);
    expect(manifestModule).not.toContain('src/private.ts');
    expect(manifestModule).not.toContain('must-not-leak');
    expect(manifestModule).not.toContain('model-state-should-not-appear');
    expect(manifestModule).not.toContain('/@fs/');
    expect(manifestModule).not.toContain('/__creasekit/');
  });
});

const createProject = async (): Promise<{
  readonly root: string;
  readonly main: string;
  readonly private: string;
}> => {
  const root = await mkdtemp(join(tmpdir(), 'creasekit-homepage-source-plugin-'));
  roots.push(root);
  await mkdir(join(root, 'src'));

  const main = `import * as stylex from '@stylexjs/stylex';
import { Runtime } from 'foldkit';
import { privateStyles } from './private';
import { styles } from './styles';

export const Model = { state: 'model-state-should-not-appear' };
const css = (...values) => stylex.props(...values).className ?? '';
export const view = (model, h) => h.div([], [
  h.button([
    h.Class(css(styles.primary)),
    h.Data('config', { password: 'must-not-leak' }),
  ], ['public source evidence']),
  h.span([h.Class(css(privateStyles.hidden))], [model.label]),
]);
export const init = () => ({});
export const update = () => ({});
Runtime.makeApplication({ Model, init, update, view, container: null });
`;
  const entry = `import { Runtime } from 'foldkit';
import { Model, init, update, view } from './main';
Runtime.run(Runtime.makeApplication({ Model, init, update, view, container: null }));
`;
  const styles = `import * as stylex from '@stylexjs/stylex';
export const styles = stylex.create({
  primary: { color: 'red', padding: 8 },
});
`;
  const privateSource = `import * as stylex from '@stylexjs/stylex';
import { Runtime } from 'foldkit';
export const privateStyles = stylex.create({ hidden: { color: 'black' } });
export const privateView = (model, h) => h.div([], ['private-source-should-not-appear']);
Runtime.makeApplication({ Model: {}, init() {}, update() {}, view: privateView, container: null });
`;
  const runtime = `export const captureCall = (value) => value();
export const observeRuntime = (value) => value;
export const registerFunction = (value) => value;
`;

  await Promise.all([
    writeFile(join(root, 'src/main.ts'), main),
    writeFile(join(root, 'src/entry.ts'), entry),
    writeFile(join(root, 'src/styles.ts'), styles),
    writeFile(join(root, 'src/private.ts'), privateSource),
    writeFile(join(root, 'src/homepage-source-runtime.ts'), runtime),
  ]);
  return { root, main, private: privateSource };
};

const prepare = async (root: string) => {
  const plugin = homepageSourceDemo();
  const context = {
    error: (error: Error | string): never => {
      throw error instanceof Error ? error : new Error(error);
    },
    resolve: async (specifier: string, importer?: string) => {
      if (importer === undefined) return null;
      if (specifier === './styles') return { id: join(dirname(importer), 'styles.ts') };
      if (specifier === './private')
        return { id: join(dirname(importer), 'private.ts') };
      return null;
    },
  };
  const configResolved = plugin.configResolved;
  if (typeof configResolved !== 'function')
    throw new Error('Missing configResolved hook');
  Reflect.apply(configResolved, {}, [{ root }]);
  const buildStart = plugin.buildStart;
  if (typeof buildStart !== 'function') throw new Error('Missing buildStart hook');
  await Reflect.apply(buildStart, context, []);
  return { plugin, context };
};

const transform = async (
  plugin: ReturnType<typeof homepageSourceDemo>,
  context: { readonly error: (error: Error | string) => never },
  code: string,
  id: string,
) => {
  const hook = plugin.transform;
  if (hook === undefined || typeof hook === 'function') {
    throw new Error('Missing object transform hook');
  }
  return Reflect.apply(hook.handler, context, [code, id, { moduleType: 'js' }]);
};

const transformOrder = (plugin: ReturnType<typeof homepageSourceDemo>) => {
  const hook = plugin.transform;
  return hook === undefined || typeof hook === 'function' ? undefined : hook.order;
};

const loadManifestModule = async (
  plugin: ReturnType<typeof homepageSourceDemo>,
  context: { readonly error: (error: Error | string) => never },
): Promise<string> => {
  const load = plugin.load;
  if (typeof load !== 'function') throw new Error('Missing load hook');
  const module = await Reflect.apply(load, context, [
    '\0virtual:creasekit-homepage-sources',
  ]);
  if (typeof module !== 'string') throw new Error('Missing homepage source manifest');
  return module;
};

const loadManifest = async (
  plugin: ReturnType<typeof homepageSourceDemo>,
  context: { readonly error: (error: Error | string) => never },
): Promise<ReadonlyArray<SourceEvidence>> => {
  const module = await loadManifestModule(plugin, context);
  const match = /^export const sources = (.*);\n$/su.exec(module);
  if (match?.[1] === undefined) throw new Error('Invalid homepage source manifest');
  return Schema.decodeUnknownSync(Schema.Array(SourceEvidenceSchema))(
    JSON.parse(match[1]),
  );
};
