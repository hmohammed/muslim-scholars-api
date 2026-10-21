import type { ParsedTk } from '../types.ts';
import { hasArabic, text } from './text.ts';

const RANKS = [
  'ثقة', 'صدوق', 'صحابي', 'ضعيف', 'مقبول', 'متروك', 'كذاب', 'حافظ', 'إمام', 'امام',
  'مجهول', 'ثبت', 'الفقيه', 'القاضي', 'صدوق حسن الحديث', 'ثقة حافظ',
];

function fieldsOf(html: string): string[] {
  return html
    .split(/<br\s*\/?>/i)
    .map(part => text(part))
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isKunya(value: string): boolean {
  const first = value.split(/[,،]/)[0]?.trim() ?? '';
  return /^(?:أبو|ابو|أم|ام)(?:\s+\S+){1,3}$/.test(first) && first.length <= 40;
}

function isNisba(value: string): boolean {
  if (!value.includes(',') && !value.includes('،')) return false;
  return value.split(/[,،]/).every(part => /[\u0600-\u06FF]$/.test(part.trim()) && /(ي|ى)$/.test(part.trim()));
}

function isRank(value: string): boolean {
  const trimmed = value.trim();
  return RANKS.some(rank => trimmed === rank || trimmed.startsWith(`${rank} `));
}

function yearRun(fields: string[]): { tabaqa: number; death: number; birth: number; age: number } | null {
  const nums = fields.map(field => (/^\d{1,4}$/.test(field) ? Number(field) : null));
  for (let i = 0; i < nums.length - 3; i++) {
    const tabaqa = nums[i];
    const death = nums[i + 1];
    const birth = nums[i + 2];
    const age = nums[i + 3];
    if (tabaqa == null || death == null || birth == null || age == null) continue;
    if (tabaqa < 1 || tabaqa > 20) continue;
    if (death < 1 || death > 1500 || birth < -100 || birth > 1500 || age < 1 || age > 130) continue;
    if (Math.abs((death - birth) - age) <= 3) return { tabaqa, death, birth, age };
  }
  return null;
}

export function parseTk(html: string | null | undefined, scholarId: number): ParsedTk | null {
  if (!html) return null;
  const div = html.match(/class=['"]arabic['"][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? html;
  let parts = fieldsOf(div);
  if (parts.length === 0) return null;
  if (parts.at(-1) === String(scholarId)) parts = parts.slice(0, -1);

  const proseAt = parts.findIndex(part => part.startsWith('[') || part.includes('لا يوجد'));
  const rawFields = proseAt === -1 ? parts : parts.slice(0, proseAt);
  let textAr = proseAt === -1 ? null : parts.slice(proseAt).join('\n').trim();
  if (textAr?.endsWith(String(scholarId))) textAr = textAr.slice(0, -String(scholarId).length).trim() || null;
  const noEntry = Boolean(textAr?.includes('لا يوجد ترجمة'));

  const structured = [...rawFields];
  const tkNo = structured[0] && /^\d{3,}$/.test(structured[0]) ? Number(structured.shift()) : null;
  if (structured.at(-1) === '1') structured.pop();

  const years = yearRun(structured);
  const kunya = structured.find(isKunya) ?? null;
  const nisba = structured.find(isNisba) ?? null;
  const rank = structured.find(isRank) ?? null;
  let countries: string | null = null;
  let deathPlace: string | null = null;
  if (years) {
    const deathIndex = structured.findIndex((field, index) =>
      field === String(years.age) && structured[index - 3] === String(years.tabaqa));
    const after = deathIndex >= 0 ? structured.slice(deathIndex + 1) : [];
    const countryField = after.find(field => (field.includes(',') || field.includes('،')) && !isNisba(field));
    if (countryField) {
      countries = countryField;
      const next = after[after.indexOf(countryField) + 1];
      if (next && hasArabic(next) && !next.includes(',') && next.length <= 40) deathPlace = next;
    }
  }

  const variants = structured.filter(field => hasArabic(field) && field.length <= 80 && !isNisba(field) && !field.includes('['));

  return {
    tkNo,
    kunya,
    nisba,
    rank,
    tabaqa: years?.tabaqa ?? null,
    deathAh: years?.death ?? null,
    birthAh: years?.birth ?? null,
    age: years?.age ?? null,
    countries,
    deathPlace,
    rawFields,
    textAr,
    noEntry,
    variants,
  };
}
