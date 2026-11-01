export interface Cue { start: number; end: number; text: string }

export function approximateCues(text: string, duration: number): Cue[] {
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('Transcript requires a positive measured duration.');
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('Transcript requires spoken text.');
  const phrases: string[][] = [];
  let phrase: string[] = [];
  for (const word of words) {
    if (phrase.length && phrase.join(' ').length + word.length > 76) { phrases.push(phrase); phrase = []; }
    phrase.push(word);
    if (/[.!?;]$/.test(word)) { phrases.push(phrase); phrase = []; }
  }
  if (phrase.length) phrases.push(phrase);
  if (phrases.length > Math.floor(duration * 1000)) throw new Error('Audio is too short for valid transcript cue durations.');
  let count = 0;
  return phrases.map((group, index) => {
    const start = Math.round(count / words.length * duration * 1000) / 1000;
    count += group.length;
    const end = Math.round((index === phrases.length - 1 ? duration : count / words.length * duration) * 1000) / 1000;
    const lines: string[] = [''];
    for (const word of group) {
      if (lines[lines.length - 1].length + word.length + 1 > 42 && lines.length < 2) lines.push('');
      lines[lines.length - 1] += `${lines[lines.length - 1] ? ' ' : ''}${word}`;
    }
    return { start, end, text: lines.join('\n') };
  });
}
export function validateCues(cues: Cue[], duration: number): Cue[] {
  let end = 0;
  if (!cues.length) throw new Error('Transcript has no spoken cues.');
  for (const cue of cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < end ||
        cue.end <= cue.start || cue.end > Math.round(duration * 1000) / 1000 || !cue.text.trim() ||
        cue.text.includes('-->')) throw new Error('Transcript cues must be positive, chronological, nonoverlapping and within measured media duration.');
    end = cue.end;
  }
  return cues;
}
export function parseServiceVtt(text: string, duration: number): Cue[] {
  if (!text.replace(/^\uFEFF/, '').startsWith('WEBVTT')) throw new Error('Invalid service WebVTT.');
  const cues: Cue[] = [];
  const seconds = (value: string) => {
    const match = /^(\d{2,}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error('Invalid subtitle timestamp.');
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  };
  for (const block of text.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const lines = block.split('\n');
    const timing = lines.findIndex(line => line.includes(' --> '));
    if (timing < 0) continue;
    const [start, end] = lines[timing].split(' --> ');
    const content = lines.slice(timing + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    cues.push({ start: seconds(start), end: seconds(end.split(' ')[0]), text: content });
  }
  return validateCues(cues, duration);
}
function timestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function webVtt(scenes: { text: string; duration: number; cues?: Cue[] }[]): string {
  let offset = 0;
  let id = 0;
  const approximate = scenes.flatMap((scene, index) => scene.cues?.length ? [] : [index + 1]);
  const output = ['WEBVTT', ''];
  if (approximate.length) output.push('NOTE', `Approximate timing for scenes ${approximate.join(', ')}; cues are distributed over measured scene durations.`, '');
  for (const scene of scenes) {
    for (const cue of validateCues(scene.cues?.length ? scene.cues : approximateCues(scene.text, scene.duration), scene.duration)) {
      output.push(String(++id), `${timestamp(offset + cue.start)} --> ${timestamp(offset + cue.end)}`,
        cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), '');
    }
    offset += scene.duration;
  }
  return output.join('\n');
}
