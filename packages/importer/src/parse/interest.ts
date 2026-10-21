import type { Madhhab, ScholarGrade } from '../types.ts';
import { hasArabic, text } from './text.ts';

export const GRADES = [
  'Thiqah', 'Maqbool', 'Sadooq', 'Unknown-Majhool', 'Weak', 'Sadooq/Delusion',
  'Abandoned', 'No Doubt', 'Thiqah Thiqah', 'Not Thiqah', 'Undefined', 'Liar', 'Accused Liar',
] as const;

const MADHHAB: [RegExp, Madhhab][] = [
  [/hanafi/i, 'hanafi'],
  [/shafii|shafi/i, 'shafii'],
  [/maliki/i, 'maliki'],
  [/hanbali/i, 'hanbali'],
  [/other/i, 'other'],
];

export function parseMadhhab(value: string): Madhhab | null {
  for (const [re, madhhab] of MADHHAB) if (re.test(value)) return madhhab;
  return null;
}

export function parseGeneration(value: string): number | null {
  const match = value.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*generation/i);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 30 ? n : null;
}

export interface InterestParse {
  areas: string[];
  grade: ScholarGrade | null;
  gradeRaw: string | null;
  rumuz: string[];
  verdict: string | null;
}

function bracketSpans(value: string): { inner: string; start: number; end: number }[] {
  const spans: { inner: string; start: number; end: number }[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '[') continue;
    let depth = 0;
    for (let j = i; j < value.length; j++) {
      if (value[j] === '[') depth++;
      else if (value[j] === ']') {
        depth--;
        if (depth === 0) {
          spans.push({ inner: value.slice(i + 1, j), start: i, end: j + 1 });
          i = j;
          break;
        }
      }
    }
  }
  return spans;
}

/** Area cell: areas stay on both sides of the grade and rumuz brackets. */
export function parseInterest(html: string | null | undefined): InterestParse {
  const empty: InterestParse = { areas: [], grade: null, gradeRaw: null, rumuz: [], verdict: null };
  if (!html) return empty;
  const gradeMatch = html.match(/\[Grade:([^\]]*)\]/i);
  const gradeRaw = gradeMatch?.[1]?.trim() || null;
  const grade = GRADES.find(item => item.toLowerCase() === gradeRaw?.toLowerCase()) ?? null;

  let withoutGrade = html.replace(/\[Grade:[^\]]*\]/gi, ' ');
  const spans = bracketSpans(withoutGrade);
  const rumuz: string[] = [];
  let verdict: string | null = null;
  for (const span of [...spans].reverse()) {
    const inner = text(span.inner);
    const looksLikeCodes = hasArabic(inner) || /^\s*[\dA-Za-z\u0600-\u06FF\s\-–—]+\s*$/.test(inner);
    if (!looksLikeCodes || inner.length > 80) continue;
    const [codes, ...rest] = inner.split(/\s+[-–—]\s+/);
    for (const token of (codes ?? '').split(/\s+/)) {
      const code = token.trim();
      if (code && code !== '-' && (hasArabic(code) || /^[0-9A-Za-z]{1,3}$/.test(code))) rumuz.push(code);
    }
    const verdictText = rest.join(' - ').trim();
    if (verdictText && verdictText !== '-' && hasArabic(verdictText)) verdict = verdictText;
    withoutGrade = `${withoutGrade.slice(0, span.start)} ${withoutGrade.slice(span.end)}`;
  }

  const areas = text(withoutGrade)
    .split(',')
    .map(item => item.trim())
    .filter(item => item && item !== '-' && !/^narrator\s*\[/i.test(item));
  return { areas: [...new Set(areas)], grade, gradeRaw: grade && gradeRaw === grade ? null : gradeRaw, rumuz: [...new Set(rumuz)], verdict };
}
