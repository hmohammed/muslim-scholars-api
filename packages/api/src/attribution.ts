import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ATTRIBUTION = {
  compiler: 'Arees Institute',
  work: 'Muslim Scholars Database',
  source_url: 'https://muslimscholars.info',
  licence_note:
    'Biographies, teacher–student links and Arabic source texts were compiled by the Arees Institute and published at muslimscholars.info. ' +
    'This API republishes that compilation with attribution. It is not an official Arees service.',
};

export function scholarSourceUrl(id: number): string {
  return `https://muslimscholars.info/manage.php?submit=scholar&ID=${id}`;
}

export async function attributionHtml(): Promise<string> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/attribution.md');
  const markdown = await readFile(path, 'utf8');
  const body = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/^# (.+)$/m, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\n\n/g, '</p><p>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Attribution</title></head><body><p>${body}</p></body></html>`;
}
