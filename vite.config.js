import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/syntasia/',
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  test: { exclude: [...configDefaults.exclude, 'tests/browser/**'] },
});
