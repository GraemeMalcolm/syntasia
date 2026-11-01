import type { Attachment } from './state';
export async function readAttachments(files: File[], existing: Attachment[] = []): Promise<Attachment[]> {
  if (files.length + existing.length > 10) throw new Error('Attach at most 10 reference files.');
  if (files.reduce((sum, file) => sum + file.size, existing.reduce((sum, file) => sum + file.size, 0)) > 5 * 1024 * 1024) throw new Error('Reference files exceed the combined 5 MiB limit.');
  const result = [...existing];
  for (const file of files) {
    if (!/\.(txt|md)$/i.test(file.name)) throw new Error('Choose UTF-8 TXT or Markdown (.md) reference files.');
    if (!file.size || file.size > 1024 * 1024) throw new Error('Each reference file must be nonempty and at most 1 MiB.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); } catch { throw new Error(`${file.name}: invalid UTF-8 encoding.`); }
    if (text.includes('\0')) throw new Error(`${file.name}: binary content is not a text reference.`);
    result.push({ name: file.name, size: file.size, text });
  }
  return result;
}
// Without a deployment tokenizer, UTF-8 bytes provide a conservative token upper bound.
export function validateBudget(input: string, budget = 24000): void {
  if (new TextEncoder().encode(input).length > budget) throw new Error(`Input exceeds the conservative ${budget}-token upper-bound budget. Shorten or select references; nothing was truncated. Deployment context limits still apply.`);
}
