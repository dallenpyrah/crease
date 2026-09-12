import { defineConfig } from 'vite';
import stylex from '@stylexjs/unplugin';

import { foldkit } from '@foldkit/vite-plugin';
import { homepageSourceDemo } from './server/homepage-source-plugin';
import { creasekit } from './server/vite-plugin';

export default defineConfig({
  plugins: [
    homepageSourceDemo(),
    stylex.vite({ useCSSLayers: true }),
    foldkit(),
    creasekit(),
  ],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
});
