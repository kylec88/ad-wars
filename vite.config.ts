import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js alone is ~500 kB; it's one cached download.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        advertise: resolve(__dirname, 'advertise.html'),
      },
    },
  },
});
