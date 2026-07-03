import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, mkdirSync } from 'fs';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        viewer: resolve(__dirname, 'src/viewer/index.html'),
        background: resolve(__dirname, 'src/background.js'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    {
      name: 'copy-manifest',
      closeBundle() {
        cpSync(resolve(__dirname, 'src/manifest.json'), resolve(__dirname, 'dist/manifest.json'));
        mkdirSync(resolve(__dirname, 'dist/icons'), { recursive: true });
        cpSync(resolve(__dirname, 'public/icons'), resolve(__dirname, 'dist/icons'), { recursive: true });
      },
    },
  ],
});
