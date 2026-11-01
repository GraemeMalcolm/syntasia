import type { Config } from './configuration';
import type { Draft, Source } from './foundry';
import type { Voice } from './speech';
import type { Clip } from './types';

export type SceneStatus = 'idle' | 'queued' | 'generating' | 'rendering' | 'ready' | 'stale' | 'failed' | 'canceled';
export interface Background { name: string; url: string; width: number; height: number; blob: Blob }
export interface Scene {
  id: string;
  script: string;
  ssml: boolean;
  voiceId: string;
  avatarId: string;
  conceptual: boolean;
  background: Background | null;
  revision: number;
  sources: Source[];
  status: SceneStatus;
  previewUrl: string | null;
  clip?: Clip;
}
export interface Attachment { name: string; text: string; size: number }
export interface DraftMessage { draft: Draft; targetId: string; targetRevision: number; configRevision: number; applied: boolean }
export interface StudioState {
  config: Config | null;
  configRevision: number;
  scenes: Scene[];
  targetId: string;
  voices: Voice[];
  attachments: Attachment[];
  drafts: DraftMessage[];
  dirty: boolean;
  orderRevision: number;
  working: boolean;
}
export function emptyScene(previous?: Scene): Scene {
  return {
    id: crypto.randomUUID(), script: '', ssml: false, voiceId: previous?.voiceId ?? '', avatarId: previous?.avatarId ?? '',
    conceptual: previous?.conceptual ?? false,
    background: previous?.background ? { ...previous.background, url: URL.createObjectURL(previous.background.blob) } : null,
    revision: 0, sources: [], status: 'idle', previewUrl: null,
  };
}
export function createState(): StudioState {
  const scene = emptyScene();
  return { config: null, configRevision: 0, scenes: [scene], targetId: scene.id, voices: [], attachments: [], drafts: [], dirty: false, orderRevision: 0, working: false };
}
