export type { Config } from './configuration';
export type { Voice } from './speech';
export type { Source, Draft } from './foundry';
export type { Scene } from './state';
interface AvatarInfo { id: string; character: string; label: string; previewUrl?: string; preview?: boolean; retiredOn?: string }
export type Avatar = AvatarInfo & (
  { style?: string; photoAvatarBaseModel?: never } |
  { style?: never; photoAvatarBaseModel: 'vasa-1' }
);
export interface Clip { blob: Blob; url: string; duration: number; revision: number; fingerprint?: string; cues?: import('./transcript').Cue[] }
const avatarPreviewBase = 'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech-avatar/media/';
const lisaRetirement = '2026-12-01T00:00:00Z';
const photoAvatars: [string, string][] = [
  ['Adrian', 'adrian'], ['Amara', 'amara'], ['Amira', 'amira-avatar'], ['Anika', 'anika-avatar'],
  ['Bianca', 'bianca'], ['Camila', 'camila'], ['Carlos', 'carlos'], ['Clara', 'clara'],
  ['Darius', 'darius'], ['Diego', 'diego'], ['Elise', 'elise'], ['Farhan', 'farhan-avatar'],
  ['Faris', 'faris-avatar'], ['Gabrielle', 'gabrielle'], ['Hyejin', 'hyejin-avatar'], ['Imran', 'imran-avatar'],
  ['Isabella', 'isabella'], ['Layla', 'layla'], ['Liwei', 'liwei-avatar'], ['Ling', 'ling'],
  ['Marcus', 'marcus'], ['Matteo', 'matteo'], ['Rahul', 'rahul-avatar'], ['Rana', 'rana'],
  ['Ren', 'ren-avatar'], ['Riya', 'riya-avatar'], ['Sakura', 'sakura-avatar'], ['Simone', 'simone'],
  ['Zayd', 'zayd-avatar'], ['Zoe', 'zoe'],
];
// Microsoft Learn standard-avatars catalog, 2026-10-31. vasa-2 is real-time-only.
export const AVATARS: Avatar[] = [
  { id: 'lisa-casual-sitting', character: 'lisa', style: 'casual-sitting', label: 'Lisa · Casual sitting', previewUrl: `${avatarPreviewBase}lisa-casual-sitting.png` },
  { id: 'lisa-business-sitting', character: 'lisa', style: 'business-sitting', label: 'Lisa · Business sitting', preview: true, previewUrl: `${avatarPreviewBase}lisa-business-sitting.png` },
  { id: 'lisa-business-standing', character: 'lisa', style: 'business-standing', label: 'Lisa · Business standing', preview: true, previewUrl: `${avatarPreviewBase}lisa-business-standing.png` },
  { id: 'lisa-coach-sitting', character: 'lisa', style: 'coach-sitting', label: 'Lisa · Coach sitting', preview: true, previewUrl: `${avatarPreviewBase}lisa-coach-sitting.png` },
  { id: 'lisa-coach-standing', character: 'lisa', style: 'coach-standing', label: 'Lisa · Coach standing', preview: true, previewUrl: `${avatarPreviewBase}lisa-coach-standing.png` },
  { id: 'lisa-graceful-sitting', character: 'lisa', style: 'graceful-sitting', label: 'Lisa · Graceful sitting', retiredOn: lisaRetirement, previewUrl: `${avatarPreviewBase}lisa-graceful-sitting.png` },
  { id: 'lisa-graceful-standing', character: 'lisa', style: 'graceful-standing', label: 'Lisa · Graceful standing', retiredOn: lisaRetirement, previewUrl: `${avatarPreviewBase}lisa-graceful-standing.png` },
  { id: 'lisa-technical-sitting', character: 'lisa', style: 'technical-sitting', label: 'Lisa · Technical sitting', retiredOn: lisaRetirement, previewUrl: `${avatarPreviewBase}lisa-technical-sitting.png` },
  { id: 'lisa-technical-standing', character: 'lisa', style: 'technical-standing', label: 'Lisa · Technical standing', retiredOn: lisaRetirement, previewUrl: `${avatarPreviewBase}lisa-technical-standing.png` },
  { id: 'lori-casual', character: 'lori', style: 'casual', label: 'Lori · Casual', previewUrl: `${avatarPreviewBase}lori-casual.png` },
  { id: 'lori-graceful', character: 'lori', style: 'graceful', label: 'Lori · Graceful', previewUrl: `${avatarPreviewBase}lori-graceful.png` },
  { id: 'lori-formal', character: 'lori', style: 'formal', label: 'Lori · Formal', previewUrl: `${avatarPreviewBase}lori-formal.png` },
  { id: 'harry', character: 'harry', label: 'Harry · Default', previewUrl: `${avatarPreviewBase}harry-business.png` },
  { id: 'harry-casual', character: 'harry', style: 'casual', label: 'Harry · Casual', previewUrl: `${avatarPreviewBase}harry-casual.png` },
  { id: 'harry-youthful', character: 'harry', style: 'youthful', label: 'Harry · Youthful', previewUrl: `${avatarPreviewBase}harry-youthful.png` },
  { id: 'max-business', character: 'max', style: 'business', label: 'Max · Business', previewUrl: `${avatarPreviewBase}max-business.png` },
  { id: 'max-casual', character: 'max', style: 'casual', label: 'Max · Casual', previewUrl: `${avatarPreviewBase}max-casual.png` },
  { id: 'max-formal', character: 'max', style: 'formal', label: 'Max · Formal', previewUrl: `${avatarPreviewBase}max-formal.png` },
  { id: 'meg-business', character: 'meg', style: 'business', label: 'Meg · Business', previewUrl: `${avatarPreviewBase}meg-business.png` },
  { id: 'meg-casual', character: 'meg', style: 'casual', label: 'Meg · Casual', previewUrl: `${avatarPreviewBase}meg-casual.png` },
  { id: 'meg-formal', character: 'meg', style: 'formal', label: 'Meg · Formal', previewUrl: `${avatarPreviewBase}meg-formal.png` },
  { id: 'rowan', character: 'rowan', label: 'Rowan', previewUrl: `${avatarPreviewBase}rowan.png` },
  { id: 'celine', character: 'celine', label: 'Celine', previewUrl: `${avatarPreviewBase}celine.png` },
  { id: 'nia', character: 'nia', label: 'Nia', previewUrl: `${avatarPreviewBase}nia.png` },
  { id: 'malik', character: 'malik', label: 'Malik', previewUrl: `${avatarPreviewBase}malik.png` },
  ...photoAvatars.map(([label, image]): Avatar => ({
    id: label.toLowerCase(), character: label.toLowerCase(), label, photoAvatarBaseModel: 'vasa-1',
    previewUrl: `${avatarPreviewBase}${image}.png`,
  })),
];
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;
