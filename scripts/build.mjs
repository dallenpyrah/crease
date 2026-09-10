import { chmod, rm } from 'node:fs/promises';

import { build } from 'esbuild';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });

const shared = {
  bundle: true,
  format: 'esm',
  packages: 'external',
  target: 'es2022',
  legalComments: 'eof',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: { index: 'src/index.ts', automatic: 'src/automatic-entry.ts' },
    outdir: 'dist',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    platform: 'browser',
    loader: { '.svg': 'dataurl' },
  }),
  build({
    ...shared,
    entryPoints: { vite: 'server/vite-plugin.ts' },
    outdir: 'dist',
    platform: 'node',
  }),
  build({
    ...shared,
    entryPoints: ['server/cli.ts'],
    outfile: 'dist/cli.js',
    packages: 'bundle',
    platform: 'node',
  }),
]);

await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
