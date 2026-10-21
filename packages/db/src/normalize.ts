// Mirrors the SQL function normalize_ar. Keep the two in sync: search queries
// normalize the user's text here, and Postgres normalizes stored names.

const TASHKEEL = new RegExp(`[${[
  [0x0610, 0x061A],
  [0x0640, 0x0640],
  [0x064B, 0x065F],
  [0x0670, 0x0670],
  [0x06D6, 0x06ED],
].map(([from, to]) => `${String.fromCodePoint(from ?? 0)}-${String.fromCodePoint(to ?? 0)}`).join('')}]`, 'g');
const PUNCT = /[.,;:!?؟،؛'"“”«»()[\]{}<>/\\|`~\-_]+/g;

export function normalizeAr(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
