export type { Config } from './configuration';
export type { Voice } from './speech';
export type { Source, Draft } from './foundry';
export type { Scene } from './state';
export interface Avatar { id: string; character: string; style: string; label: string }
export interface Clip { blob: Blob; url: string; duration: number; revision: number; fingerprint?: string; cues?: import('./transcript').Cue[] }
// Maintained subset of standard, nondeprecated batch avatars (Microsoft Learn, 2026-10-31).
export const AVATARS: Avatar[] = [
  { id: 'lisa-casual-sitting', character: 'lisa', style: 'casual-sitting', label: 'Lisa · Casual sitting' },
  { id: 'lori-casual', character: 'lori', style: 'casual', label: 'Lori · Casual' },
];
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;
