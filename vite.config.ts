import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const root = path.resolve(__dirname);
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: path.join(root, 'ui'),
  base: './',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.join(root, 'ui'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 8933,
    fs: {
      allow: [root],
    },
  },
  build: {
    outDir: path.join(root, 'ui-build'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: path.join(root, 'ui', 'dashboard.html'),
        popup: path.join(root, 'ui', 'popup.html'),
      },
    },
  },
});
