import type { Voice } from './speech';
const namespace = 'http://www.w3.org/2001/10/synthesis';
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]!));
}
export function toSsml(text: string, voice: Voice): string {
  if (!voice.id || !voice.locale) throw new Error('Select a valid Azure voice.');
  return `<speak version="1.0" xmlns="${namespace}" xml:lang="${escapeXml(voice.locale)}"><voice name="${escapeXml(voice.id)}">${escapeXml(text)}</voice></speak>`;
}
function parseSsml(text: string): Document {
  if (/<!|<\?/i.test(text)) throw new Error('SSML entities, document types and processing instructions are not permitted.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'speak' ||
      doc.documentElement.namespaceURI !== namespace) throw new Error('Enter valid SSML with a Speech synthesis speak root and namespace.');
  const allowed: Record<string, string[]> = {
    speak: ['version', 'xmlns', 'xml:lang'], voice: ['name'], p: [], s: [],
    break: ['time', 'strength'], emphasis: ['level'], prosody: ['rate', 'pitch', 'volume'],
    'say-as': ['interpret-as', 'format', 'detail'], sub: ['alias'], phoneme: ['alphabet', 'ph'],
  };
  for (const element of doc.querySelectorAll('*')) {
    if (element.namespaceURI !== namespace || !allowed[element.tagName] ||
        [...element.attributes].some(attr => !allowed[element.tagName]!.includes(attr.name) || /[<>]|url\s*\(/i.test(attr.value))) {
      throw new Error(`Unsupported SSML element or attribute: ${element.tagName}. External audio and resources are not allowed.`);
    }
    if (element.tagName === 'break' && element.hasAttribute('time') && !/^\d{1,4}(ms|s)$/.test(element.getAttribute('time')!)) throw new Error('Invalid SSML break time.');
    if (element.tagName === 'break' && element.hasAttribute('time')) {
      const value = element.getAttribute('time')!;
      if (parseInt(value) * (value.endsWith('ms') ? 1 : 1000) > 10000) throw new Error('SSML pauses must not exceed 10 seconds.');
    }
  }
  const voices = doc.querySelectorAll('voice');
  if (doc.documentElement.getAttribute('version') !== '1.0') throw new Error('SSML speak version must be 1.0.');
  if (voices.length !== 1 || voices[0]!.parentElement !== doc.documentElement || !voices[0]!.getAttribute('name')) throw new Error('SSML must contain exactly one voice directly within speak.');
  if ([...doc.documentElement.childNodes].some(n => n !== voices[0] && n.textContent?.trim())) throw new Error('All spoken SSML content must be inside the selected voice.');
  return doc;
}
export function validateSsml(text: string, voice?: Voice): string {
  const doc = parseSsml(text);
  if (voice) {
    doc.querySelector('voice')!.setAttribute('name', voice.id);
    doc.documentElement.setAttribute('xml:lang', voice.locale);
  }
  return new XMLSerializer().serializeToString(doc);
}
export function spokenText(script: string, ssml = /^\s*<speak\b/.test(script)): string {
  if (!ssml) return script.trim();
  const doc = parseSsml(script);
  for (const sub of doc.querySelectorAll('sub')) sub.textContent = sub.getAttribute('alias') || sub.textContent;
  for (const boundary of doc.querySelectorAll('p,s,break')) boundary.append(doc.createTextNode(' '));
  return (doc.documentElement.textContent || '').replace(/\s+/g, ' ').trim();
}
