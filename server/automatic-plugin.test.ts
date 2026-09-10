import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { foldkit } from '@foldkit/vite-plugin';
import stylex from '@stylexjs/unplugin';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

import { creasekit } from './vite-plugin';

it('never injects the browser observer into server-side transforms', () => {
  const plugin = creasekit();
  if (
    typeof plugin.configResolved !== 'function' ||
    typeof plugin.transform !== 'object'
  )
    throw new Error('Unexpected plugin hooks');
  Reflect.apply(plugin.configResolved, {}, [
    { root: process.cwd(), server: { host: '127.0.0.1' } },
  ]);
  const source = `import { Runtime } from 'foldkit';
const Model = {};
const view = (model, h) => h.main([], []);
Runtime.makeApplication({ Model, view, init() {}, update() {}, container: null });`;
  const id = resolve('src/main.ts');
  expect(
    Reflect.apply(plugin.transform.handler, {}, [source, id, { ssr: true }]),
  ).toBeUndefined();
  expect(
    Reflect.apply(plugin.transform.handler, {}, [source, id, { ssr: false }]).code,
  ).toContain('observeRuntime');
});

it('captures original TypeScript positions before StyleX and FoldKit rewrite the source', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'creasekit-source-map-')));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}');
    await writeFile(
      join(root, 'index.html'),
      '<div id="root"></div><script type="module" src="/src/main.ts"></script>',
    );
    await writeFile(
      join(root, 'src/main.ts'),
      [
        "import * as stylex from '@stylexjs/stylex';",
        "import type { HtmlBuilder } from 'foldkit/html';",
        "const styles = stylex.create({ button: { color: 'red' } });",
        'export const view = (model: { count: number }, h: HtmlBuilder<never>) => ({',
        '  title: "Source positions",',
        '  body: h.button([h.Class(stylex.props(styles.button).className)], [String(model.count)]),',
        '});',
      ].join('\n'),
    );
    server = await createServer({
      root,
      configFile: false,
      cacheDir: join(root, '.vite'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, fs: { allow: [root, process.cwd()] } },
      plugins: [stylex.vite({ useCSSLayers: true }), foldkit(), creasekit()],
    });
    await server.listen();
    expect(server.config.optimizeDeps.exclude).toContain('creasekit');
    const transformed = await server.transformRequest('/src/main.ts');
    expect(transformed?.code).toMatch(
      /"file":\s*"src\/main.ts",\s*"view":\s*"view",\s*"line":\s*6,\s*"column":\s*9/,
    );
    expect(transformed?.code).toMatch(/"line":\s*4,\s*"column":\s*1/);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
