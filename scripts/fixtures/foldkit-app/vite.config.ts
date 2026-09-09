import { foldkit } from '@foldkit/vite-plugin';
import { creasekit } from 'creasekit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [foldkit(), creasekit()],
  server: { host: '127.0.0.1' },
});
