import { defineConfig } from 'vite';
import stylex from '@stylexjs/unplugin';

import { foldkit } from '@foldkit/vite-plugin';
import { creaseBridge } from './server/vite-plugin';

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true }), foldkit(), creaseBridge()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
});
