import { defineConfig } from 'vite';

export default defineConfig({
  base: '/syntasia/',
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
});
