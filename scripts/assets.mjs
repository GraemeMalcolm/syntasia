import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

for (const [folder, pkg, names] of [
  ['core', '@ffmpeg/core', ['ffmpeg-core.js', 'ffmpeg-core.wasm']],
  ['core-mt', '@ffmpeg/core-mt', ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js']],
]) {
  const destination = join('public', 'vendor', folder);
  await mkdir(destination, { recursive: true });
  for (const name of names) {
    await copyFile(join('node_modules', pkg, 'dist', 'esm', name), join(destination, name));
  }
}
await mkdir(join('public', 'vendor', 'fonts'), { recursive: true });
await mkdir(join('public', 'vendor', 'ffmpeg'), { recursive: true });
for (const name of ['worker.js', 'const.js', 'errors.js']) {
  await copyFile(join('node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm', name), join('public', 'vendor', 'ffmpeg', name));
}
await copyFile(
  join('node_modules', '@fontsource', 'caveat', 'files', 'caveat-latin-400-normal.woff2'),
  join('public', 'vendor', 'fonts', 'caveat.woff2'),
);
for (const [source, destination] of [
  ['node_modules/@fontsource/caveat/LICENSE', 'public/vendor/fonts/LICENSE'],
  ['node_modules/@ffmpeg/core/package.json', 'public/vendor/core/package.json'],
  ['node_modules/@ffmpeg/core-mt/package.json', 'public/vendor/core-mt/package.json'],
]) {
  await copyFile(source, destination);
}
