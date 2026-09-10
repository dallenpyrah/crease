import { chmod, readFile, rm, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });

const shared = {
  bundle: true,
  format: 'esm',
  packages: 'external',
  target: 'es2022',
  legalComments: 'eof',
};

const [, , cli] = await Promise.all([
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
    metafile: true,
  }),
]);

const bundledPackages = new Set();
for (const output of Object.values(cli.metafile.outputs)) {
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    const directory = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1];
    if (directory !== undefined && bytesInOutput > 0) bundledPackages.add(directory);
  }
}
const notices = await Promise.all(
  [...bundledPackages].sort().map(async (directory) => {
    const { name, version } = JSON.parse(
      await readFile(`${directory}/package.json`, 'utf8'),
    );
    return `${name}@${version}\n\n${await readFile(`${directory}/LICENSE`, 'utf8')}`;
  }),
);
await writeFile(
  new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url),
  notices.join('\n\n---\n\n'),
);
await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
