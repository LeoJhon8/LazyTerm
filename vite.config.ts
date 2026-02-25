// vite.config.ts
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  
  plugins: [
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: ['electron', 'node-pty', 'ssh2'],
            },
          },
        },
      },
      {
        entry: 'src/main/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist/main',
          },
        },
      },
    ]),
    renderer(),
  ],
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
