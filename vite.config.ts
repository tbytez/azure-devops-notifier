import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = path.resolve(__dirname);

export default defineConfig({
  plugins: [react()],
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
