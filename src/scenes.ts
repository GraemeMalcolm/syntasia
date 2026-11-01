import { emptyScene, type Background, type Scene, type StudioState } from './state';

export const MAX_SCENES = 20;
export function invalidateScene(scene: Scene): void {
  scene.revision++;
  if (scene.previewUrl) URL.revokeObjectURL(scene.previewUrl);
  scene.previewUrl = null;
  scene.status = scene.status === 'ready' || scene.status === 'stale' ? 'stale' : 'idle';
}
export function addScene(state: StudioState): Scene {
  if (state.working) throw new Error('Production locks scene editing.');
  if (state.scenes.length >= MAX_SCENES) throw new Error('The maximum is 20 scenes.');
  const scene = emptyScene();
  state.scenes.push(scene);
  state.targetId = scene.id;
  state.dirty = true;
  state.orderRevision++;
  return scene;
}
export function hasSceneWork(scene: Scene): boolean {
  return !!(scene.script.trim() || scene.background || scene.previewUrl || scene.ssml || scene.conceptual);
}
export function deleteScene(state: StudioState, id: string): void {
  if (state.working) throw new Error('Production locks scene editing.');
  if (state.scenes.length === 1) throw new Error('Keep at least one scene.');
  const scene = state.scenes.find(item => item.id === id);
  if (!scene) return;
  releaseScene(scene);
  state.scenes = state.scenes.filter(item => item.id !== id);
  if (state.targetId === id) state.targetId = state.scenes[0]!.id;
  state.orderRevision++;
  state.dirty = true;
}
export function moveScene(state: StudioState, id: string, direction: -1 | 1): void {
  if (state.working) throw new Error('Production locks scene order.');
  const index = state.scenes.findIndex(scene => scene.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.scenes.length) return;
  const scene = state.scenes.splice(index, 1)[0]!;
  state.scenes.splice(target, 0, scene);
  state.orderRevision++;
  state.dirty = true;
}
export function releaseScene(scene: Scene): void {
  if (scene.background) URL.revokeObjectURL(scene.background.url);
  if (scene.previewUrl) URL.revokeObjectURL(scene.previewUrl);
  if (scene.clip) URL.revokeObjectURL(scene.clip.url);
}
export async function readBackground(file: File): Promise<Background> {
  if (!/\.(jpe?g|png)$/i.test(file.name)) throw new Error('Choose a JPEG or PNG file.');
  if (file.size > 10 * 1024 * 1024 || !file.size) throw new Error('Background must be nonempty and no larger than 10 MiB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((!png && !jpeg) || (png && !/\.png$/i.test(file.name)) || (jpeg && !/\.jpe?g$/i.test(file.name))) throw new Error('The decoded file type must match its JPEG/PNG extension.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('Background dimensions must be at most 4096 pixels on either side.');
    return { name: file.name, url, width: image.naturalWidth, height: image.naturalHeight, blob: file };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error ? error : new Error('Cannot decode this JPEG/PNG background.');
  }
}
