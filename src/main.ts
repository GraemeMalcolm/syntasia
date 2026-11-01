import '@picocss/pico/css/pico.min.css';
import '../styles.css';
import { normalizeConfig, loadSettings, saveSettings, clearSettings, type Config } from './configuration';
import { FoundryClient } from './foundry';
import { loadVoices, previewSpeech, avatarVideo, type Voice } from './speech';
import { toSsml, spokenText, validateSsml } from './ssml';
import { readAttachments, validateBudget } from './chat';
import { probeCapabilities } from './capability';
import { publicError } from './errors';
import { createState, type Scene, type DraftMessage } from './state';
import { addScene, deleteScene, moveScene, invalidateScene, hasSceneWork, readBackground, MAX_SCENES, releaseScene } from './scenes';
import { AVATARS } from './types';
import { generatePlan } from './animation';
import { animationVideo, audioDuration, concatenate, imageBackground, normalizeAvatar } from './production';
import { webVtt } from './transcript';
import { AVATAR_REGIONS, avatarEndpoint } from './avatar';
import { bootstrapIsolation } from './coi-bootstrap';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing application control: ${id}`);
  return node as T;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function button(text: string, action: () => void, className = 'secondary', disabled = false): HTMLButtonElement {
  const result = node('button', text, className);
  result.type = 'button';
  result.disabled = disabled;
  result.addEventListener('click', action);
  return result;
}
const state = createState();
const configDialog = element<HTMLDialogElement>('config-dialog');
const confirmDialog = element<HTMLDialogElement>('confirm-dialog');
const configForm = element<HTMLFormElement>('config-form');
const chatPanel = element<HTMLElement>('chat-panel');
const narrow = window.matchMedia('(max-width: 760px)');
let client: FoundryClient | null = null;
let chatAbort: AbortController | null = null;
let voiceAbort: AbortController | null = null;
let reloadVoicesAfterCancel = false;
let settingsPersisted = true;
let attachmentRevision = 0;
let chatRevision = 0;
let confirmPending: ((accepted: boolean) => void) | null = null;
let confirmReturn: HTMLElement | null = null;
let drawerBackdrop: HTMLDivElement | null = null;
const speechOperations = new Map<string, AbortController>();
const backgroundOperations = new Map<string, number>();
const audioPlayers = new Map<string, HTMLAudioElement>();
const voiceSelect = element<HTMLSelectElement>('voice');
const targetSelect = element<HTMLSelectElement>('target');
const prompt = element<HTMLTextAreaElement>('prompt');
const send = element<HTMLButtonElement>('send');
const avatarSelect = element<HTMLSelectElement>('avatar');
let generationAbort: AbortController | null = null;
let mediaQualified = false;
let alphaQualified = false;
const outputUrls: string[] = [];
for (const region of AVATAR_REGIONS) {
  const option = node('option');
  option.value = region;
  element('speech-regions').append(option);
}
window.addEventListener('syntasia-storage-error', event => status((event as CustomEvent<string>).detail));

function status(message: string): void { element('status').textContent = message; }
function configStatus(message: string): void { element('config-status').textContent = message; }
function errorStatus(error: unknown): void { status(publicError(error)); }
function confirmAction(title: string, message: string, accept = 'Continue'): Promise<boolean> {
  if (confirmPending) return Promise.resolve(false);
  confirmReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  element('confirm-title').textContent = title;
  element('confirm-text').textContent = message;
  element('confirm-accept').textContent = accept;
  if (configDialog.open) configDialog.inert = true;
  confirmDialog.showModal();
  element('confirm-cancel').focus();
  return new Promise(resolve => { confirmPending = resolve; });
}
function settleConfirm(accepted: boolean): void {
  const resolve = confirmPending;
  confirmPending = null;
  confirmDialog.close();
  configDialog.inert = false;
  if (confirmReturn?.isConnected) confirmReturn.focus();
  resolve?.(accepted);
}
element('confirm-accept').addEventListener('click', () => settleConfirm(true));
element('confirm-cancel').addEventListener('click', () => settleConfirm(false));
confirmDialog.addEventListener('cancel', event => { event.preventDefault(); settleConfirm(false); });

function selectedVoice(): Voice | undefined { return state.voices.find(voice => voice.id === state.voiceId); }
function fingerprint(scene: Scene): string {
  return JSON.stringify([scene.id, scene.revision, state.configRevision, state.voiceId, scene.conceptual ? '' : state.avatarId]);
}
function generationGate(scene: Scene): string {
  if (!state.config || !selectedVoice()) return 'Save Configuration to load Speech voices.';
  if (!scene.script.trim()) return 'Enter spoken narration.';
  if (!mediaQualified) return 'Local 1080p encode/mux/playback fixture did not pass. Use a supported desktop browser/device.';
  if (!scene.conceptual) {
    if (!state.avatarId) return 'Select an avatar in a supported Speech region.';
    try { avatarEndpoint(state.config, 'syntasia-validation'); } catch (error) { return publicError(error); }
    if (scene.background && !alphaQualified) return 'Transparent VP9 alpha decoding fixture did not pass. Remove the background or use a supported browser.';
  }
  return '';
}
function invalidateOutput(): void {
  for (const url of outputUrls.splice(0)) URL.revokeObjectURL(url);
  const output = element('output');
  output.replaceChildren(node('h2', 'No assembled video yet'), node('p', 'Produce to assemble all current scenes. Previous output is invalidated when inputs change.'));
}
function refreshLocks(): void {
  const controls = document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>(
    '.workspace input, .workspace textarea, .workspace select, .workspace button, .toolbar-actions button:not(#chat-toggle), .toolbar-actions select, #config-form input, #config-form button',
  );
  for (const control of controls) {
    if (state.working) {
      if (!('lockDisabled' in control.dataset)) control.dataset.lockDisabled = String(control.disabled);
      control.disabled = true;
    } else if ('lockDisabled' in control.dataset) {
      control.disabled = control.dataset.lockDisabled === 'true';
      delete control.dataset.lockDisabled;
    }
  }
  element<HTMLButtonElement>('cancel-production').disabled = !state.working;
  if (!state.working) {
    element<HTMLButtonElement>('produce').disabled = state.scenes.some(scene => !!generationGate(scene));
    for (const scene of state.scenes) {
      const generate = document.querySelector<HTMLButtonElement>(`#scene-${scene.id} [data-generate]`);
      if (generate) { generate.disabled = !!generationGate(scene); generate.title = generationGate(scene); }
    }
    element('video-gates').textContent = state.scenes.map((scene, index) => generationGate(scene) ? `Scene ${index + 1}: ${generationGate(scene)}` : '').filter(Boolean).join(' ') ||
      'Ready to generate. Azure service access is checked during generation.';
  }
}
function renderAvatars(): void {
  avatarSelect.replaceChildren(node('option', 'Select avatar'));
  avatarSelect.options[0].value = '';
  const available = state.config && AVATAR_REGIONS.includes(state.config.speechRegion) ? AVATARS : [];
  for (const avatar of available) {
    const option = node('option', avatar.label);
    option.value = avatar.id;
    avatarSelect.append(option);
  }
  if (!available.some(item => item.id === state.avatarId)) state.avatarId = available[0]?.id ?? '';
  avatarSelect.value = state.avatarId;
  avatarSelect.disabled = !state.config || !state.voices.length || !available.length;
}
function stopSpeech(scene: Scene): void {
  speechOperations.get(scene.id)?.abort();
  speechOperations.delete(scene.id);
  const audio = audioPlayers.get(scene.id);
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  audioPlayers.delete(scene.id);
  if (scene.previewUrl) URL.revokeObjectURL(scene.previewUrl);
  scene.previewUrl = null;
}
function mutate(scene: Scene, manual = false): void {
  invalidateOutput();
  stopSpeech(scene);
  invalidateScene(scene);
  if (scene.clip) scene.status = 'stale';
  backgroundOperations.set(scene.id, (backgroundOperations.get(scene.id) ?? 0) + 1);
  if (manual) scene.sources = [];
  state.dirty = true;
  const row = document.getElementById(`scene-${scene.id}`);
  if (row) {
    const message = row.querySelector<HTMLElement>('.scene-status');
    if (message) message.textContent = `Revision ${scene.revision} · ${scene.status}${scene.clip ? ` · ${scene.clip.duration.toFixed(1)}s` : ' · no generated video'}`;
    row.querySelector('audio')?.remove();
    const stop = row.querySelector<HTMLButtonElement>('[data-stop]');
    if (stop) stop.disabled = true;
    const preview = row.querySelector<HTMLButtonElement>('[data-preview]');
    if (preview) preview.disabled = !state.config || !selectedVoice() || !scene.script.trim();
    const generate = row.querySelector<HTMLButtonElement>('[data-generate]');
    if (generate) generate.disabled = !state.config || !selectedVoice() || !scene.script.trim() || (!scene.conceptual && !state.avatarId);
  }
  updateDraftButtons();
  refreshLocks();
}
function cancelChat(): void {
  chatRevision++;
  chatAbort?.abort();
  chatAbort = null;
  updateSend();
}
function cancelConfigurationWork(): void {
  voiceAbort?.abort();
  voiceAbort = null;
}
function resetConfiguration(config: Config | null): void {
  cancelChat();
  cancelConfigurationWork();
  client?.reset();
  state.config = config;
  state.configRevision++;
  client = config ? new FoundryClient(config) : null;
  state.voices = [];
  state.voiceId = '';
  for (const scene of state.scenes) mutate(scene);
  renderVoices();
  renderAvatars();
  renderScenes();
  updateSend();
}
function updateSend(): void {
  send.disabled = state.working || !state.config || !!chatAbort || !prompt.value.trim();
  element<HTMLButtonElement>('cancel-chat').disabled = !chatAbort;
  element('send-hint').textContent = !state.config ? 'Save session credentials to enable Send.' : chatAbort ? 'Request running. Partial output cannot be applied.' : 'Ready to request a draft · service/tool compatibility remains conditional.';
}
function configInput(): Config {
  const responsesOrigin = element<HTMLInputElement>('responses-origin').value;
  const speechOrigin = element<HTMLInputElement>('speech-endpoint').value;
  const speechRegion = element<HTMLInputElement>('speech-region').value.trim();
  if (!speechRegion) throw new Error('Enter your Speech resource region.');
  return normalizeConfig({
    projectUrl: element<HTMLInputElement>('project-url').value,
    key: element<HTMLInputElement>('authorization-key').value,
    model: element<HTMLInputElement>('model-name').value,
    ...(responsesOrigin ? { responsesOrigin } : {}),
    ...(speechOrigin ? { speechOrigin } : {}),
    speechKey: element<HTMLInputElement>('speech-key').value,
    speechRegion
  });
}
function sameConfig(a: Config, b: Config): boolean {
  return a.projectUrl === b.projectUrl && a.key === b.key && a.model === b.model && a.responsesOrigin === b.responsesOrigin && a.speechOrigin === b.speechOrigin && a.speechKey === b.speechKey && a.speechRegion === b.speechRegion;
}
function openConfig(): void {
  reloadVoicesAfterCancel = !!voiceAbort;
  const stored = loadSettings();
  const config = state.config;
  element<HTMLInputElement>('project-url').value = config?.projectUrl ?? stored.projectUrl;
  element<HTMLInputElement>('model-name').value = config?.model ?? stored.model;
  element<HTMLInputElement>('authorization-key').value = config?.key ?? '';
  element<HTMLInputElement>('responses-origin').value = config?.responsesOrigin ?? '';
  element<HTMLInputElement>('speech-endpoint').value = config?.speechOrigin ?? '';
  element<HTMLInputElement>('speech-key').value = config?.speechKey ?? '';
  element<HTMLInputElement>('speech-region').value = config?.speechRegion ?? '';
  element<HTMLInputElement>('authorization-key').type = 'password';
  element('reveal-key').textContent = 'Reveal';
  element('reveal-key').setAttribute('aria-pressed', 'false');
  configStatus('');
  configDialog.showModal();
  element('project-url').focus();
}
function closeConfig(restoreCatalog = true): void {
  configDialog.close();
  configForm.reset();
  for (const id of ['authorization-key', 'speech-key']) element<HTMLInputElement>(id).value = '';
  element('configuration').focus();
  if (restoreCatalog && reloadVoicesAfterCancel && state.config && !state.voices.length && !voiceAbort) {
    void loadConfiguredVoices(state.config, settingsPersisted);
  }
  reloadVoicesAfterCancel = false;
}
element('configuration').addEventListener('click', openConfig);
element('config-cancel').addEventListener('click', () => closeConfig());
configDialog.addEventListener('cancel', event => { event.preventDefault(); closeConfig(); });
element('reveal-key').addEventListener('click', () => {
  const input = element<HTMLInputElement>('authorization-key');
  input.type = input.type === 'password' ? 'text' : 'password';
  element('reveal-key').textContent = input.type === 'password' ? 'Reveal' : 'Hide';
  element('reveal-key').setAttribute('aria-pressed', String(input.type === 'text'));
});
configForm.addEventListener('input', () => {
  cancelConfigurationWork();
  cancelChat();
  for (const scene of state.scenes) stopSpeech(scene);
  renderScenes();
  configStatus('');
});
configForm.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const config = configInput();
    const persisted = saveSettings(config);
    settingsPersisted = persisted;
    if (!state.config || !sameConfig(state.config, config)) resetConfiguration(config);
    closeConfig(false);
    void loadConfiguredVoices(config, persisted);
  } catch (error) { configStatus(publicError(error)); }
});
element('clear-settings').addEventListener('click', () => {
  void (async () => {
    if (!await confirmAction('Clear settings?', 'Remove persisted project/model and all active credentials and service settings? Scene edits and local files are retained. Stored Foundry conversations are not deleted.', 'Clear settings')) return;
    const cleared = clearSettings();
    resetConfiguration(null);
    closeConfig();
    status(cleared ? 'Settings and active credentials cleared. Scene edits retained.' : 'Active credentials cleared. Browser storage could not be accessed; persisted values may remain.');
  })();
});
async function loadConfiguredVoices(config: Config, persisted: boolean): Promise<void> {
  const controller = new AbortController();
  const revision = state.configRevision;
  voiceAbort?.abort();
  voiceAbort = controller;
  state.voices = [];
  renderVoices();
  renderAvatars();
  renderScenes();
  status(persisted ? 'Loading voices…' : 'Settings are session-only because browser storage is unavailable. Loading voices…');
  try {
    const voices = await loadVoices(config, controller.signal);
    if (controller.signal.aborted || voiceAbort !== controller || state.configRevision !== revision) return;
    if (!voices.length) throw new Error('Speech returned no voices. Check your Speech resource and save Configuration to retry.');
    const voice = voices.find(item => item.id === state.voiceId) ?? voices[0];
    const scripts = new Map<string, string>();
    for (const scene of state.scenes) if (scene.ssml) scripts.set(scene.id, validateSsml(scene.script, voice));
    state.voices = voices;
    state.voiceId = voice.id;
    for (const scene of state.scenes) {
      scene.script = scripts.get(scene.id) ?? scene.script;
      mutate(scene);
    }
    renderVoices();
    renderAvatars();
    renderScenes();
    const message = AVATAR_REGIONS.includes(config.speechRegion)
      ? 'Configuration ready.'
      : `Voices loaded. Avatars are not supported in ${config.speechRegion}; use a Speech resource in a supported region.`;
    status(persisted ? message : `${message} Settings are session-only because browser storage is unavailable.`);
  } catch (error) {
    if (!controller.signal.aborted) status(`Could not load voices: ${publicError(error)} Check Configuration and save to retry.`);
  } finally {
    if (voiceAbort === controller) voiceAbort = null;
  }
}
function renderVoices(): void {
  voiceSelect.replaceChildren(node('option', 'Select voice'));
  voiceSelect.options[0]!.value = '';
  for (const voice of state.voices) {
    const option = node('option', `${voice.name} · ${voice.locale} · ${voice.id}`);
    option.value = voice.id;
    voiceSelect.append(option);
  }
  voiceSelect.disabled = !state.voices.length;
  voiceSelect.value = state.voiceId;
}
voiceSelect.addEventListener('change', () => {
  const next = state.voices.find(voice => voice.id === voiceSelect.value);
  const changes = new Map<string, string>();
  try {
    for (const scene of state.scenes) if (scene.ssml && next) changes.set(scene.id, validateSsml(scene.script, next));
  } catch (error) { voiceSelect.value = state.voiceId; errorStatus(error); return; }
  state.voiceId = voiceSelect.value;
  for (const scene of state.scenes) {
    scene.script = changes.get(scene.id) ?? scene.script;
    mutate(scene);
  }
  renderScenes();
  status('Voice changed. All narration previews invalidated; selected voice is authoritative for SSML.');
});

function renderTargets(): void {
  targetSelect.replaceChildren();
  state.scenes.forEach((scene, index) => {
    const option = node('option', `Scene ${index + 1}`);
    option.value = scene.id;
    targetSelect.append(option);
  });
  targetSelect.value = state.targetId;
  element('scene-count').textContent = `${state.scenes.length} scene draft${state.scenes.length === 1 ? '' : 's'} · session only`;
  element<HTMLButtonElement>('add-scene').disabled = state.working || state.scenes.length >= MAX_SCENES;
}
function labeledCheck(text: string, id: string, checked: boolean, change: (input: HTMLInputElement) => void): HTMLLabelElement {
  const label = node('label', undefined, 'check');
  const input = node('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  label.htmlFor = id;
  label.append(input, document.createTextNode(text));
  input.addEventListener('change', () => change(input));
  return label;
}
function renderScenes(): void {
  for (const audio of audioPlayers.values()) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  audioPlayers.clear();
  const container = element('scenes');
  container.replaceChildren();
  state.scenes.forEach((scene, index) => {
    const card = node('article', undefined, `card scene-card${scene.id === state.targetId ? ' selected' : ''}`);
    card.id = `scene-${scene.id}`;
    card.setAttribute('aria-label', `Scene ${index + 1}`);
    const heading = node('div', undefined, 'row scene-heading');
    const title = node('h2');
    title.append(node('span', String(index + 1), 'scene-number'), document.createTextNode(`Scene ${index + 1}`));
    const controls = node('div', undefined, 'row');
    controls.append(button('Target', () => { state.targetId = scene.id; renderScenes(); }, 'ghost'),
      button('Move up', () => { invalidateOutput(); moveScene(state, scene.id, -1); renderScenes(); }, 'ghost', index === 0),
      button('Move down', () => { invalidateOutput(); moveScene(state, scene.id, 1); renderScenes(); }, 'ghost', index === state.scenes.length - 1),
      button('Delete scene', () => { void removeScene(scene); }, 'ghost', state.scenes.length === 1));
    heading.append(title, controls);
    const columns = node('div', undefined, 'scene-columns');
    const editor = node('div', undefined, 'scene-editor');
    const scriptLabel = node('label', 'Script');
    scriptLabel.htmlFor = `script-${scene.id}`;
    const script = node('textarea');
    script.id = scriptLabel.htmlFor;
    script.value = scene.script;
    script.placeholder = 'Write your narration here…';
    script.addEventListener('input', () => { scene.script = script.value; mutate(scene, true); });
    const speech = button('Preview speech', () => { void synthesize(scene); }, 'secondary', !state.config || !selectedVoice() || !scene.script.trim() || speechOperations.has(scene.id));
    speech.dataset.preview = '';
    const stop = button('Stop', () => { stopSpeech(scene); renderScenes(); status('Speech preview stopped and discarded.'); }, 'ghost', !scene.previewUrl && !speechOperations.has(scene.id));
    stop.dataset.stop = '';
    const generate = button('Generate', () => { void generateScenes([scene], false); }, '',
      !state.config || !selectedVoice() || !scene.script.trim() || (!scene.conceptual && !state.avatarId));
    generate.dataset.generate = '';
    generate.setAttribute('aria-describedby', 'video-gates');
    const actions = node('div', undefined, 'row');
    actions.append(speech, stop, generate);
    const sceneStatus = node('p', speechOperations.has(scene.id) ? 'Synthesizing preview audio…' : `Revision ${scene.revision} · ${scene.status}${scene.clip ? ` · ${scene.clip.duration.toFixed(1)}s · 1080p` : ' · no generated video'}`, 'scene-status');
    sceneStatus.setAttribute('role', 'status');
    editor.append(scriptLabel, script, labeledCheck('Use Speech Synthesis Markup Language (SSML)', `ssml-${scene.id}`, scene.ssml, input => { void switchSsml(scene, input); }), actions, sceneStatus);
    if (scene.previewUrl) {
      const audio = node('audio');
      audio.controls = true;
      audio.src = scene.previewUrl;
      audio.setAttribute('aria-label', `Speech preview for scene ${index + 1}`);
      audioPlayers.set(scene.id, audio);
      editor.append(audio);
    }
    const preview = node('div', undefined, 'scene-preview');
    const canvas = node('div', undefined, 'media-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', scene.conceptual ? 'White conceptual canvas without avatar, no generated video' : 'Unselected avatar placeholder, no synthesized video');
    if (scene.background && !scene.conceptual) {
      const image = node('img');
      image.src = scene.background.url;
      image.alt = '';
      canvas.append(image);
    }
    if (scene.clip) {
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-label');
      canvas.replaceChildren();
      const video = node('video');
      video.controls = true; video.playsInline = true; video.src = scene.clip.url;
      video.setAttribute('aria-label', `Scene ${index + 1} video${scene.clip.revision !== scene.revision ? ' (stale)' : ''}`);
      canvas.append(video);
    } else {
      const caption = node('div', undefined, 'media-label');
      const avatar = scene.conceptual || !state.voices.length ? undefined : AVATARS.find(item => item.id === state.avatarId);
      if (avatar?.previewUrl) {
        canvas.setAttribute('aria-label', `${avatar.label} preview image, no generated video`);
        const image = node('img', undefined, 'avatar-preview');
        image.referrerPolicy = 'no-referrer';
        image.src = avatar.previewUrl;
        image.alt = `${avatar.label} preview`;
        image.addEventListener('error', () => {
          if (!image.isConnected) return;
          image.remove();
          caption.replaceChildren(node('strong', avatar.label), node('small', 'Preview image unavailable'));
          canvas.append(caption);
          status(`Could not load the preview image for ${avatar.label}. Avatar synthesis remains available.`);
        }, { once: true });
        canvas.append(image, node('small', 'Preview · Microsoft Learn', 'avatar-caption'));
      } else {
        caption.append(node('span', scene.conceptual ? '▱' : '▷', 'media-symbol'),
          node('strong', scene.conceptual ? 'White animation canvas' : 'Select an avatar'),
          node('small', 'No generated video'));
        canvas.append(caption);
      }
    }
    const uploadId = `background-${scene.id}`;
    const upload = node('input');
    upload.id = uploadId;
    upload.type = 'file';
    upload.accept = '.jpg,.jpeg,.png';
    upload.hidden = true;
    upload.disabled = scene.conceptual;
    upload.addEventListener('change', () => { const file = upload.files?.[0]; if (file) void uploadBackground(scene, file); upload.value = ''; });
    const uploadButton = button('Upload background', () => upload.click(), 'secondary', scene.conceptual);
    const remove = button('Remove background', () => {
      if (scene.background) URL.revokeObjectURL(scene.background.url);
      scene.background = null;
      mutate(scene);
      renderScenes();
    }, 'ghost', scene.conceptual || !scene.background);
    const backgroundHint = node('small', scene.conceptual ? 'No avatar or background in animation mode. Existing images are retained locally and restored in avatar mode.' : scene.background ? `${scene.background.name} · ${scene.background.width} × ${scene.background.height} · local only; output transparency unverified` : 'Local JPEG/PNG · up to 10 MiB · max 4096px. Transparent video output is unverified.');
    backgroundHint.id = `background-hint-${scene.id}`;
    uploadButton.setAttribute('aria-describedby', backgroundHint.id);
    remove.setAttribute('aria-describedby', backgroundHint.id);
    const backgroundActions = node('div', undefined, 'row');
    backgroundActions.append(uploadButton, remove);
    preview.append(canvas, upload, backgroundActions, labeledCheck('Conceptual animation', `conceptual-${scene.id}`, scene.conceptual, input => {
      scene.conceptual = input.checked;
      mutate(scene);
      renderScenes();
    }), backgroundHint);
    columns.append(editor, preview);
    card.append(heading, columns);
    container.append(card);
  });
  renderTargets();
  updateDraftButtons();
  refreshLocks();
}
async function removeScene(scene: Scene): Promise<void> {
  if (state.scenes.length === 1) return;
  const revision = scene.revision;
  if (hasSceneWork(scene) && !await confirmAction('Delete scene?', 'Delete this scene and its session-only script, background and audio? This cannot be undone.', 'Delete scene')) return;
  if (!state.scenes.includes(scene) || scene.revision !== revision) { status('Scene changed while confirmation was open. Delete again to confirm current work.'); return; }
  stopSpeech(scene);
  invalidateOutput();
  backgroundOperations.delete(scene.id);
  deleteScene(state, scene.id);
  renderScenes();
  element('add-scene').focus();
}
async function switchSsml(scene: Scene, input: HTMLInputElement): Promise<void> {
  const wantsSsml = input.checked;
  input.checked = scene.ssml;
  const revision = scene.revision;
  try {
    let script: string;
    if (wantsSsml) {
      const voice = selectedVoice();
      if (!voice) throw new Error('Load and select an Azure Speech voice before converting to SSML.');
      script = toSsml(scene.script, voice);
    } else {
      if (!await confirmAction('Convert SSML to plain text?', 'Pauses, emphasis and other markup effects will be lost. Cancel keeps the exact SSML unchanged.', 'Convert to plain text')) return;
      script = spokenText(scene.script);
    }
    if (scene.revision !== revision || !state.scenes.includes(scene)) { status('Scene changed; conversion not applied.'); return; }
    scene.script = script;
    scene.ssml = wantsSsml;
    mutate(scene);
    renderScenes();
    element<HTMLTextAreaElement>(`script-${scene.id}`).focus();
  } catch (error) { errorStatus(error); }
}
async function uploadBackground(scene: Scene, file: File): Promise<void> {
  const revision = scene.revision;
  const ticket = (backgroundOperations.get(scene.id) ?? 0) + 1;
  backgroundOperations.set(scene.id, ticket);
  try {
    const background = await readBackground(file);
    if (state.working || !state.scenes.includes(scene) || scene.revision !== revision || scene.conceptual || backgroundOperations.get(scene.id) !== ticket) { URL.revokeObjectURL(background.url); return; }
    if (scene.background) URL.revokeObjectURL(scene.background.url);
    scene.background = background;
    mutate(scene);
    renderScenes();
    status('Background decoded and validated. It stays local; composited video output remains unqualified.');
  } catch (error) { errorStatus(error); }
}
async function synthesize(scene: Scene): Promise<void> {
  const config = state.config;
  const voice = selectedVoice();
  if (!config || !voice) return;
  const revision = scene.revision;
  const configRevision = state.configRevision;
  const voiceId = state.voiceId;
  let script: string;
  try {
    script = scene.ssml ? validateSsml(scene.script, voice) : scene.script;
    if (!(scene.ssml ? spokenText(script) : script).trim()) throw new Error('Enter spoken text before synthesizing a preview.');
  } catch (error) { errorStatus(error); return; }
  if (!await confirmAction('Billable Speech preview', 'Send this scene narration and selected voice to Azure Speech? Synthesis can incur charges. The returned audio stays in this session and does not generate video.', 'Synthesize preview')) return;
  if (scene.revision !== revision || state.configRevision !== configRevision || state.voiceId !== voiceId || !state.scenes.includes(scene)) { status('Inputs changed; speech preview was not sent.'); return; }
  stopSpeech(scene);
  const controller = new AbortController();
  speechOperations.set(scene.id, controller);
  renderScenes();
  try {
    const blob = await previewSpeech(config, script, scene.ssml, voice, controller.signal);
    if (controller.signal.aborted || scene.revision !== revision || state.configRevision !== configRevision || state.voiceId !== voiceId || !state.scenes.includes(scene)) return;
    const measured = await audioDuration(blob);
    if (!(measured > 0) || controller.signal.aborted || state.configRevision !== configRevision || scene.revision !== revision) return;
    scene.previewUrl = URL.createObjectURL(blob);
    status('Speech preview ready. Use audio controls to play; no video was generated.');
  } catch (error) { if (!controller.signal.aborted) errorStatus(error); }
  finally {
    if (speechOperations.get(scene.id) === controller) speechOperations.delete(scene.id);
    renderScenes();
  }
}
element('add-scene').addEventListener('click', () => {
  try { invalidateOutput(); const scene = addScene(state); renderScenes(); element(`script-${scene.id}`).focus(); } catch (error) { errorStatus(error); }
});
targetSelect.addEventListener('change', () => { state.targetId = targetSelect.value; renderScenes(); });
prompt.addEventListener('input', () => { if (prompt.value) state.dirty = true; updateSend(); });

function updateDraftButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-draft-index]').forEach(apply => {
    const message = state.drafts[Number(apply.dataset.draftIndex)];
    if (!message) return;
    const scene = state.scenes.find(item => item.id === message.targetId);
    const stale = !scene || scene.revision !== message.targetRevision || state.configRevision !== message.configRevision;
    apply.disabled = state.working || !!chatAbort || message.applied || stale;
    apply.textContent = message.applied ? 'Applied' : stale ? 'Target changed · draft cannot overwrite edits' : `Apply to scene ${state.scenes.indexOf(scene!) + 1}`;
  });
}
async function applyDraft(message: DraftMessage): Promise<void> {
  const scene = state.scenes.find(item => item.id === message.targetId);
  if (state.working || !scene || scene.revision !== message.targetRevision || state.configRevision !== message.configRevision || message.applied || chatAbort) { status('Draft target changed or production is locked. Manual edits will not be overwritten.'); return; }
  if (!message.draft.editorial && !message.draft.researched && !await confirmAction('Apply unresearched draft?', 'Required research was not verified. This narration does not satisfy researched-generation requirements. Apply it only as an explicitly unresearched draft?', 'Apply unresearched draft')) return;
  if (scene.script.trim() && !await confirmAction('Replace scene script?', 'Replace the existing script in this target scene with the completed draft? Other scenes remain unchanged.', 'Replace script')) return;
  if (state.working || scene.revision !== message.targetRevision || state.configRevision !== message.configRevision || !state.scenes.includes(scene) || chatAbort) { status('Inputs changed; draft not applied.'); return; }
  try {
    const voice = selectedVoice();
    const narration = scene.ssml ? voice ? validateSsml(message.draft.narration, voice) : (() => { throw new Error('Select an Azure voice to validate SSML before applying.'); })() : message.draft.narration;
    if (!narration.trim()) throw new Error('Empty narration cannot be applied.');
    scene.script = narration;
    scene.sources = [...message.draft.sources];
    mutate(scene);
    message.applied = true;
    renderScenes();
    status('Completed draft applied to its original target scene only.');
  } catch (error) { errorStatus(error); }
}
function appendMessage(title: string, text: string, className = ''): HTMLElement {
  const history = element('chat-history');
  history.querySelector('.empty-chat')?.remove();
  const article = node('article', undefined, `chat-message ${className}`);
  article.append(node('strong', title), node('p', text));
  history.append(article);
  return article;
}
function renderAttachments(): void {
  const list = element('attachment-list');
  list.replaceChildren();
  state.attachments.forEach((attachment, index) => {
    const row = node('div', undefined, 'attachment');
    const remove = button('Remove', () => {
      attachmentRevision++;
      state.attachments.splice(index, 1);
      renderAttachments();
    }, 'ghost');
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    row.append(node('span', `${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KiB`), remove);
    list.append(row);
  });
}
element<HTMLInputElement>('attachments').addEventListener('change', event => {
  const input = event.currentTarget as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const ticket = ++attachmentRevision;
  void (async () => {
    try {
      const attachments = await readAttachments(files, state.attachments);
      if (attachmentRevision !== ticket) return;
      state.attachments = attachments;
      state.dirty = true;
      renderAttachments();
      status('Reference files validated locally. Contents are sent only after Send consent.');
    } catch (error) { errorStatus(error); }
  })();
});
element('composer').addEventListener('submit', event => { event.preventDefault(); void sendDraft(); });
async function sendDraft(): Promise<void> {
  const config = state.config;
  const activeClient = client;
  const target = state.scenes.find(scene => scene.id === state.targetId);
  if (!config || !activeClient || !target || chatAbort || state.working || !prompt.value.trim()) return;
  const text = prompt.value.trim();
  const targetRevision = target.revision;
  const configRevision = state.configRevision;
  const attachments = state.attachments.map(file => ({ name: file.name, text: file.text }));
  const filesRevision = attachmentRevision;
  const editorial = element<HTMLInputElement>('editorial').checked;
  const microsoftRequested = element<HTMLInputElement>('microsoft').checked;
  const microsoft = microsoftRequested || /\b(microsoft|azure|foundry|power\s*(bi|platform|pages)|windows|\.net)\b/i.test(`${text}\n${target.script}\n${attachments.map(file => file.text).join('\n')}`);
  try {
    validateBudget([text, target.script, ...attachments.map(file => file.text)].join('\n'));
    if (editorial && !target.script.trim()) throw new Error('Editorial requests require an existing target-scene script.');
    if (target.ssml) {
      const voice = selectedVoice();
      if (!voice) throw new Error('Select a voice before requesting SSML narration.');
      validateSsml(target.script, voice);
    }
  } catch (error) { errorStatus(error); return; }
  if (!await confirmAction('Send to Foundry?', 'Your prompt, selected script, reference files and conversation will be sent to Azure. Responses uses store: true under the service retention policy. A research request may make up to two additional research attempts; all may incur model/tool charges. Web Search has separate grounding terms/data boundaries. Only https://learn.microsoft.com/api/mcp has fixed automatic approval (require_approval: never). New chat resets local continuity; it does not delete cloud data.', 'Send billable request')) return;
  if (state.configRevision !== configRevision || target.revision !== targetRevision || state.targetId !== target.id || prompt.value.trim() !== text || attachmentRevision !== filesRevision || editorial !== element<HTMLInputElement>('editorial').checked || microsoftRequested !== element<HTMLInputElement>('microsoft').checked || !state.scenes.includes(target) || chatAbort) { status('Request inputs changed; nothing was sent.'); return; }
  const ticket = ++chatRevision;
  const controller = new AbortController();
  chatAbort = controller;
  updateSend();
  appendMessage('Your request', text);
  const pending = appendMessage(editorial ? 'Editing selected scene…' : 'Researching selected scene…', 'Waiting for validated, complete narration.');
  const output = pending.querySelector('p')!;
  pending.setAttribute('aria-busy', 'true');
  try {
    const draft = await activeClient.generate({ prompt: text, script: target.script, ssml: target.ssml, editorial, microsoft, attachments, sources: [...target.sources], signal: controller.signal, onDelta: delta => {
      if (!controller.signal.aborted && ticket === chatRevision) { output.textContent = (output.dataset.started ? output.textContent ?? '' : '') + delta; output.dataset.started = 'true'; }
    } });
    if (controller.signal.aborted || ticket !== chatRevision || state.configRevision !== configRevision) {
      output.textContent = 'Obsolete or canceled response discarded. No partial narration can be applied.';
      return;
    }
    pending.remove();
    const message: DraftMessage = { draft, targetId: target.id, targetRevision, configRevision, applied: false };
    const index = state.drafts.push(message) - 1;
    const article = appendMessage(draft.editorial ? 'Completed editorial revision · not newly researched' : draft.researched ? 'Completed draft · required research verified' : 'Draft · research NOT verified', draft.narration, 'draft');
    for (const source of draft.sources) {
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'https:' || url.username || url.password) continue;
        const link = node('a', source.title || url.hostname);
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        article.append(link);
      } catch { continue; }
    }
    const apply = button('Apply to scene', () => { void applyDraft(message); }, '');
    apply.dataset.draftIndex = String(index);
    article.append(apply);
    if (prompt.value.trim() === text) prompt.value = '';
    state.dirty = true;
    status('Completed draft available. Apply is protected by original target identity and revision.');
  } catch (error) {
    if (controller.signal.aborted) output.textContent = 'Request canceled. Partial narration is discarded and cannot be applied. Remote processing or charges may continue.';
    else { output.textContent = publicError(error); status(publicError(error)); }
  } finally {
    pending.removeAttribute('aria-busy');
    if (chatAbort === controller) chatAbort = null;
    updateSend();
    updateDraftButtons();
  }
}
element('cancel-chat').addEventListener('click', () => { cancelChat(); status('Request canceled locally. No partial response is applied; remote processing and charges may continue.'); });
element('new-chat').addEventListener('click', () => {
  void (async () => {
    if ((state.drafts.length || element('chat-history').querySelector('.chat-message')) && !await confirmAction('Start new chat?', 'Clear the local conversation and response chain? Scene edits, unsent prompt and attachments are retained. This does not delete Foundry-stored conversations.', 'New chat')) return;
    cancelChat();
    client?.reset();
    state.drafts = [];
    const history = element('chat-history');
    history.replaceChildren(node('p', 'No conversation yet. Write locally or connect your own services.', 'empty-chat'));
    status('New local conversation. Existing service data is not deleted.');
  })();
});

function setChat(open: boolean): void {
  chatPanel.hidden = !open;
  element('chat-toggle').setAttribute('aria-expanded', String(open));
  document.querySelector('.workspace')?.classList.toggle('chat-collapsed', !open);
  drawerBackdrop?.remove();
  drawerBackdrop = null;
  if (open && narrow.matches) {
    drawerBackdrop = node('div', undefined, 'drawer-backdrop');
    drawerBackdrop.addEventListener('click', () => setChat(false));
    document.body.append(drawerBackdrop);
    chatPanel.setAttribute('role', 'dialog');
    chatPanel.setAttribute('aria-modal', 'true');
    document.querySelector('main > .intro')?.setAttribute('inert', '');
    element('scenes').closest('.scene-list')?.setAttribute('inert', '');
    document.querySelector('.toolbar')?.setAttribute('inert', '');
    element('chat-close').focus();
  } else {
    chatPanel.removeAttribute('role');
    chatPanel.removeAttribute('aria-modal');
    document.querySelector('main > .intro')?.removeAttribute('inert');
    element('scenes').closest('.scene-list')?.removeAttribute('inert');
    document.querySelector('.toolbar')?.removeAttribute('inert');
    if (!open) element('chat-toggle').focus();
  }
}
element('chat-toggle').addEventListener('click', () => setChat(chatPanel.hidden));
element('chat-close').addEventListener('click', () => setChat(false));
narrow.addEventListener('change', () => setChat(!narrow.matches));
chatPanel.addEventListener('keydown', event => {
  if (!narrow.matches || chatPanel.hidden || configDialog.open || confirmDialog.open) return;
  if (event.key === 'Escape') { event.preventDefault(); setChat(false); }
  if (event.key === 'Tab') {
    const focusable = Array.from(chatPanel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')).filter(control => !control.hidden);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => {
  generationAbort?.abort();
  for (const url of outputUrls) URL.revokeObjectURL(url);
  cancelChat();
  cancelConfigurationWork();
  for (const scene of state.scenes) { stopSpeech(scene); releaseScene(scene); }
});

async function initialize(): Promise<void> {
  const startupMessage = await bootstrapIsolation();
  element('startup').textContent = `${startupMessage} Testing local media; editing is available.`;
  renderScenes();
  renderAvatars();
  updateSend();
  document.querySelector('.workspace')?.removeAttribute('inert');
  element<HTMLButtonElement>('configuration').disabled = false;
  element<HTMLButtonElement>('chat-toggle').disabled = false;
  setChat(!narrow.matches);
  try {
    const capabilities = await probeCapabilities(startupMessage);
    mediaQualified = capabilities.pipeline;
    alphaQualified = capabilities.alpha;
    element('startup').textContent = `${capabilities.message} Editing is local. No live service requests have run.`;
    element('browser-status').textContent = `Isolation: ${capabilities.isolated ? 'yes' : 'no'} · SharedArrayBuffer: ${capabilities.sharedArrayBuffer ? 'yes' : 'no'} · local 1080p pipeline fixture: ${capabilities.pipeline ? 'passed' : 'failed'} · alpha decode: ${capabilities.alpha ? 'passed' : 'failed'} · Azure and deployed Pages NOT qualified`;
    element('media-status').textContent = capabilities.pipeline ? 'Local browser 1080p encode/decode/mux/playback fixture passed. External services remain independently conditional.' : 'Local encoding fixture failed; Generate and Produce disabled.';
  } catch (error) {
    element('startup').textContent = `Browser checks failed: ${publicError(error)} Local editing remains available; video stays disabled.`;
    element('browser-status').textContent = 'Browser capability checks failed · video disabled';
  }
  renderScenes();
  renderAvatars();
  updateSend();
}
void initialize();

avatarSelect.addEventListener('change', () => {
  state.avatarId = avatarSelect.value;
  for (const scene of state.scenes) if (!scene.conceptual) mutate(scene);
  renderScenes();
});
element('produce').addEventListener('click', () => { void generateScenes([...state.scenes], true); });
element('cancel-production').addEventListener('click', () => {
  generationAbort?.abort();
  status('Canceling local generation/production. Remote Azure jobs may continue and incur charges.');
});
async function generateScenes(scenes: Scene[], produce: boolean): Promise<void> {
  const config = state.config;
  const voice = selectedVoice();
  if (!config || !voice || state.working) return;
  const avatar = AVATARS.find(item => item.id === state.avatarId);
  const revisions = scenes.map(scene => scene.revision);
  const orderRevision = state.orderRevision;
  const voiceId = state.voiceId;
  const avatarId = state.avatarId;
  const fingerprints = scenes.map(fingerprint);
  try {
    for (const scene of scenes) {
      const gate = generationGate(scene);
      if (gate) throw new Error(gate);
      if (!spokenText(scene.script, scene.ssml)) throw new Error('Every scene needs spoken narration.');
      if (scene.ssml) validateSsml(scene.script, voice);
      if (!scene.conceptual && !avatar) throw new Error('Select an avatar for presentation scenes.');
    }
  } catch (error) { errorStatus(error); return; }
  const configRevision = state.configRevision;
  if (!await confirmAction(produce ? 'Produce your video?' : 'Generate this scene?',
    'Send narration to Azure Speech to generate missing/stale scenes? Conceptual scenes also use your Foundry model with store: true under Azure retention. These operations are billable; service access and output are checked during generation, without separate test jobs. Local images are not uploaded. Editing is locked until completion or Cancel; remote jobs may continue after cancellation. VTT timing is approximate where service cues are unavailable.', 'Generate')) return;
  if (state.working || state.configRevision !== configRevision || state.orderRevision !== orderRevision || state.voiceId !== voiceId || state.avatarId !== avatarId ||
      scenes.some((scene, index) => !state.scenes.includes(scene) || scene.revision !== revisions[index])) {
    status('Inputs changed while confirmation was open. Nothing was generated.'); return;
  }
  cancelChat();
  cancelConfigurationWork();
  attachmentRevision++;
  for (const [id, ticket] of backgroundOperations) backgroundOperations.set(id, ticket + 1);
  for (const scene of state.scenes) stopSpeech(scene);
  state.working = true;
  for (const scene of scenes) if (scene.clip?.fingerprint !== fingerprint(scene)) scene.status = 'queued';
  const controller = new AbortController();
  generationAbort = controller;
  refreshLocks();
  const progress = (text: string) => { element('production-status').textContent = text; status(text); };
  try {
    for (const scene of scenes) {
      if (scene.clip?.fingerprint === fingerprint(scene)) continue;
      const revision = scene.revision;
      scene.status = 'generating';
      renderScenes();
      progress(`Generating scene ${state.scenes.indexOf(scene) + 1}…`);
      let media;
      if (scene.conceptual) {
        const audio = await previewSpeech(config, scene.script, scene.ssml, voice, controller.signal);
        const duration = await audioDuration(audio);
        if (duration > 300) throw new Error('Narration exceeds the five-minute scene limit.');
        progress('Designing a safe sketch animation…');
        const plan = await generatePlan(config, spokenText(scene.script, scene.ssml), duration, controller.signal);
        scene.status = 'rendering';
        media = await animationVideo(plan, audio, duration, controller.signal, progress);
      } else {
        if (!avatar) throw new Error('Avatar selection is unavailable.');
        const source = await avatarVideo(config, scene.script, scene.ssml, voice, avatar, !!scene.background, controller.signal, progress);
        const background = scene.background ? await imageBackground(scene.background.blob) : undefined;
        scene.status = 'rendering';
        media = await normalizeAvatar(source, background, controller.signal, progress);
      }
      controller.signal.throwIfAborted();
      if (scene.revision !== revision || state.configRevision !== configRevision) throw new Error('Scene changed during generation; result discarded.');
      if (scene.clip) URL.revokeObjectURL(scene.clip.url);
      scene.clip = { ...media, url: URL.createObjectURL(media.blob), revision, fingerprint: fingerprint(scene) };
      scene.status = 'ready'; state.dirty = true;
      renderScenes();
    }
    if (produce) {
      const clips = scenes.map(scene => {
        if (!scene.clip || scene.clip.fingerprint !== fingerprint(scene)) throw new Error('Scene output is missing or stale.');
        return scene.clip;
      });
      const media = await concatenate(clips, controller.signal, progress);
      controller.signal.throwIfAborted();
      if (state.orderRevision !== orderRevision || scenes.some((scene, index) => fingerprint(scene) !== fingerprints[index])) throw new Error('Production snapshot changed; final output was discarded.');
      const vttText = webVtt(scenes.map((scene, index) => ({
        text: spokenText(scene.script, scene.ssml), duration: clips[index].duration, cues: clips[index].cues,
      })));
      invalidateOutput();
      const url = URL.createObjectURL(media.blob);
      const transcript = URL.createObjectURL(new Blob([vttText], { type: 'text/vtt;charset=utf-8' }));
      outputUrls.push(url, transcript);
      const output = element('output');
      output.replaceChildren(node('h2', 'Your video is ready'), node('p', `1920 × 1080 · H.264/AAC · Transcript timing: ${clips.some(clip => !clip.cues?.length) ? 'approximate' : 'service-provided'}`));
      const video = node('video');
      video.controls = true; video.playsInline = true; video.src = url;
      const track = node('track'); track.kind = 'subtitles'; track.label = 'Narration'; track.srclang = voice.locale.split('-')[0]; track.src = transcript; video.append(track);
      output.append(video);
      const name = `syntasia-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      for (const [label, href, filename] of [['Download MP4', url, `${name}.mp4`], ['Download VTT', transcript, `${name}.vtt`]]) {
        const link = node('a', label);
        link.href = href; link.download = filename; link.className = 'download';
        output.append(link);
      }
      progress(`Produced ${media.duration.toFixed(1)} seconds of 1080p video.`);
    } else progress('1080p scene ready. Use its video player to preview.');
  } catch (error) {
    for (const scene of scenes) if (scene.status === 'generating' || scene.status === 'rendering') scene.status = controller.signal.aborted ? 'canceled' : 'failed';
    for (const scene of scenes) if (scene.status === 'queued') scene.status = controller.signal.aborted ? 'canceled' : scene.clip ? 'stale' : 'idle';
    errorStatus(controller.signal.aborted ? new DOMException('Canceled', 'AbortError') : error);
    element('production-status').textContent = controller.signal.aborted ? 'Production canceled; controls unlocked after cleanup.' : 'Production failed; successful clips retained.';
  } finally {
    if (generationAbort === controller) generationAbort = null;
    state.working = false;
    refreshLocks(); renderScenes(); updateSend(); updateDraftButtons();
  }
}
