import type { DateQualifier, DeathCause } from '../types.ts';

export interface ParsedDate {
  yearAh: number | null;
  yearAhAlt: number | null;
  yearCe: number | null;
  qualifier: DateQualifier | null;
  place: string | null;
  dateNote: string | null;
  cause: DeathCause | null;
  event: string | null;
  raw: string;
  unparsed: boolean;
}

const MONTH = /\b(?:muharram|safar|rabi|jumad|jamad|rajab|sha.?ban|ramad|shawwal|dhul|dhu\s*al|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

const EVENTS: [RegExp, string][] = [
  [/uhud/i, 'Uhud'],
  [/yamam/i, 'Yamamah'],
  [/badr/i, 'Badr'],
  [/khandaq|trench/i, 'Khandaq'],
  [/hunay|hunain/i, 'Hunayn'],
  [/tabuk/i, 'Tabuk'],
  [/khaybar/i, 'Khaybar'],
  [/mu.?tah/i, "Mu'tah"],
  [/siffin/i, 'Siffin'],
  [/jamal|camel/i, 'Camel'],
  [/yarmu/i, 'Yarmuk'],
  [/qadis/i, 'Qadisiyyah'],
  [/karbal/i, 'Karbala'],
  [/nahraw/i, 'Nahrawan'],
  [/ajnad/i, 'Ajnadayn'],
  [/harra/i, 'al-Harra'],
  [/ma.?un|mu.?na/i, "Bi'r Ma'una"],
  [/ta'?if|al-ta/i, "Ta'if"],
  [/huroor|hurur/i, 'Hururiyya'],
  [/hudayb/i, 'Hudaybiyyah'],
];

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function mapEvent(raw: string): string {
  const trimmed = clean(raw).replace(/^[("']+|[)"']+$/g, '');
  for (const [re, name] of EVENTS) if (re.test(trimmed)) return name;
  return trimmed;
}

function causeOf(word: string): DeathCause | null {
  const w = word.toLowerCase();
  if (w.includes('poison')) return 'poisoned';
  if (w.includes('plague')) return 'plague';
  if (w.includes('kill')) return 'killed';
  if (w.includes('martyr') || w.includes('martry')) return 'martyred';
  if (w.includes('natural')) return 'natural';
  return null;
}

function extractBracket(input: string): { body: string; inner: string | null } {
  const start = input.indexOf('[');
  if (start < 0) return { body: input, inner: null };
  let depth = 0;
  for (let i = start; i < input.length; i++) {
    if (input[i] === '[') depth++;
    else if (input[i] === ']') {
      depth--;
      if (depth === 0) {
        return { body: `${input.slice(0, start)} ${input.slice(i + 1)}`, inner: input.slice(start + 1, i) };
      }
    }
  }
  return { body: input.slice(0, start), inner: input.slice(start + 1) };
}

interface ParenGroup { content: string; start: number; end: number }

function parenGroups(input: string): ParenGroup[] {
  const groups: ParenGroup[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== '(') continue;
    let depth = 1;
    let j = i + 1;
    for (; j < input.length && depth > 0; j++) {
      if (input[j] === '(') depth++;
      else if (input[j] === ')') depth--;
      if (depth === 0) break;
    }
    if (depth === 0) {
      groups.push({ content: input.slice(i + 1, j), start: i, end: j + 1 });
      i = j;
    } else {
      const end = input.indexOf('[', i);
      const stop = end === -1 ? input.length : end;
      groups.push({ content: input.slice(i + 1, stop), start: i, end: stop });
      break;
    }
  }
  return groups;
}

function cleanPlace(value: string): string | null {
  const place = clean(value).replace(/^[,\s]+|[,\s]+$/g, '');
  return place || null;
}

function classifyParen(content: string): { place: string | null; note: string | null } {
  const trimmed = clean(content);
  if (!trimmed) return { place: null, note: null };
  if (/^(\.?\s*est\.?|approx\.?|circa|c\.|estimated)$/i.test(trimmed)) {
    return { place: null, note: trimmed.replace(/^\./, '').replace(/\.$/, '') };
  }
  const nested = trimmed.match(/\(([^()]*)\)/);
  const withoutNested = nested ? clean(trimmed.replace(/\([^()]*\)/, '')) : trimmed;
  const isNote = /\d+\s*(st|nd|rd|th)\b/i.test(withoutNested) || MONTH.test(withoutNested);
  if (isNote) {
    const inner = nested?.[1] ?? '';
    const place = inner && !/est|approx/i.test(inner) ? cleanPlace(inner) : null;
    return { place, note: withoutNested.replace(/[()]/g, '').trim() || null };
  }
  return { place: cleanPlace(trimmed), note: null };
}

interface YearHit { ah: number[]; ce: number[]; between: boolean; or: boolean }

function takeYears(body: string): { years: YearHit; rest: string } {
  const ah: number[] = [];
  const ce: number[] = [];
  let between = false;
  let or = false;
  const consumed: [number, number][] = [];

  const era = /~?\s*&?\s*(\d{1,4})(?:\s*[-/]\s*(\d{1,4}))?\s*(AH|BH|CE)\b/gi;
  for (const match of body.matchAll(era)) {
    const first = Number(match[1]);
    const second = match[2] ? Number(match[2]) : null;
    const kind = (match[3] ?? '').toUpperCase();
    const at = match.index ?? 0;
    consumed.push([at, at + match[0].length]);
    if (kind === 'CE') {
      if (first >= 100) ce.push(first);
      continue;
    }
    const sign = kind === 'BH' ? -1 : 1;
    ah.push(sign * first);
    if (second !== null && second < 400) {
      ah.push(sign * second);
      between = match[0].includes('-') || match[0].includes('/');
    } else if (second !== null && second >= 400) {
      ce.push(second);
    }
  }

  let rest = body;
  for (const [start, end] of consumed.sort((a, b) => b[0] - a[0])) {
    rest = `${rest.slice(0, start)} ${rest.slice(end)}`;
  }

  // "187/802" with no era: the large number is CE and the small one is AH.
  rest = rest.replace(/(\d{1,4})\s*\/\s*(\d{3,4})/g, (full, a: string, b: string) => {
    const left = Number(a);
    const right = Number(b);
    if (right >= 400 && left < 400) {
      ah.push(left);
      ce.push(right);
      return ' ';
    }
    if (left < 400 && right < 400) {
      ah.push(left, right);
      between = true;
      return ' ';
    }
    return full;
  });

  // Bare year: "~128", "122", or a number tied to another AH year by "or".
  const bare = rest.match(/(^|[^\d])(~?\s*)(\d{1,4})(?!\s*(st|nd|rd|th)\b)(?=$|[^\d])/i);
  if (ah.length === 0 && ce.length === 0 && bare?.[3]) {
    const n = Number(bare[3]);
    if (n >= 500 && n <= 2100) ce.push(n);
    else if (n > 0 && n < 1500) ah.push(n);
    rest = rest.replace(bare[0], bare[1] ?? ' ');
  } else {
    rest = rest.replace(/(?:^|\bor\b)\s*~?\s*(\d{1,4})(?!\s*(st|nd|rd|th)\b)(?=$|[^\d])/gi, (full, n: string) => {
      const value = Number(n);
      if (value > 0 && value < 400) {
        ah.push(value);
        or = true;
        return ' ';
      }
      if (value >= 500 && value <= 2100) {
        ce.push(value);
        return ' ';
      }
      return full;
    });
  }

  // "4 AH/626" and "1429/2008": 400 or more is a CE year, anything smaller is AH.
  rest = rest.replace(/(\d{1,4})\s*\/\s*(\d{3,4})|(\d{3,4})/g, (full, left: string | undefined, right: string | undefined, alone: string | undefined) => {
    const absorb = (value: number) => {
      if (value >= 400 && value <= 2100) ce.push(value);
      else if (value > 0 && value < 400) ah.push(value);
    };
    if (left && right) {
      const a = Number(left);
      const b = Number(right);
      if (b >= 400 && (a < 400 || (a < 1600 && b >= 1000))) {
        ah.push(a);
        ce.push(b);
      } else {
        absorb(a);
        absorb(b);
      }
      return ' ';
    }
    if (alone) {
      absorb(Number(alone));
      return ' ';
    }
    return full;
  });

  if (/\bor\b/i.test(body) && ah.length >= 2) or = true;
  return { years: { ah, ce, between, or }, rest };
}

function qualifierOf(body: string, years: YearHit, hasYear: boolean): DateQualifier | null {
  if (!hasYear) return null;
  if (years.or) return 'or';
  if (years.between) return 'between';
  if (/\bbefore\b|\bearlier\b|</i.test(body)) return 'before';
  if (/\bafter\b|\blater\b|>/i.test(body)) return 'after';
  if (/~|\bapprox\b|\baround\b|\bcirca\b|\best\b/i.test(body)) return 'approx';
  return 'exact';
}

/** Parse one birth or death cell. `unparsed` is true when a digit is left over. */
export function parseDate(rawInput: string | null | undefined, kind: 'birth' | 'death'): ParsedDate | null {
  const raw = clean(rawInput ?? '');
  if (!raw) return null;

  const { body: withoutBracket, inner } = extractBracket(raw);
  let cause: DeathCause | null = null;
  let event: string | null = null;
  if (inner && kind === 'death') {
    const causes = [...inner.matchAll(/[A-Za-z][A-Za-z']*/g)]
      .map(match => causeOf(match[0]))
      .filter((value): value is DeathCause => value !== null);
    const preferred = ['poisoned', 'plague', 'killed', 'martyred', 'natural'] as const;
    cause = preferred.find(item => causes.includes(item)) ?? null;
    const eventMatch = inner.match(/[([]\s*([^)\]]+?)\s*[)\]]/);
    if (eventMatch?.[1] && !causeOf(eventMatch[1])) event = mapEvent(eventMatch[1]);
  }

  const groups = parenGroups(withoutBracket);
  const notes: string[] = [];
  let place: string | null = null;
  for (const group of groups) {
    const classified = classifyParen(group.content);
    if (classified.note) notes.push(classified.note);
    if (classified.place) place = classified.place;
  }
  let body = withoutBracket;
  for (const group of [...groups].sort((a, b) => b.start - a.start)) {
    body = `${body.slice(0, group.start)} ${body.slice(group.end)}`;
  }

  body = body.replace(new RegExp(String.raw`\d{1,2}\s*(st|nd|rd|th)?\s*(?:${MONTH.source})`, 'ig'), match => {
    notes.push(clean(match));
    return ' ';
  });
  body = body.replace(new RegExp(String.raw`(?:${MONTH.source})\s*\d{1,2}`, 'ig'), match => {
    notes.push(clean(match));
    return ' ';
  });

  const { years, rest } = takeYears(body);
  if (notes.some(note => MONTH.test(note)) && years.ah.length === 0 && years.ce.length >= 2) {
    const first = years.ce[0] ?? 0;
    const second = years.ce[1] ?? 0;
    if (first < 1500 && second >= 1500) years.ah.unshift(years.ce.shift() ?? first);
  }
  const yearAh = years.ah[0] ?? null;
  const yearAhAlt = years.ah[1] ?? null;
  const yearCe = years.ce[0] ?? null;
  const hasYear = yearAh !== null || yearCe !== null;
  if (cause === 'natural' && !hasYear && !place) cause = null;

  const qualifier = qualifierOf(raw, years, hasYear);
  const leftover = clean(rest)
    .replace(/\b(ah|bh|ce|or|before|after|later|earlier|around|approx|est|alive|natural|killed|martyred|martyr|plague|poisoned|student|ibn|bin|of|the|and|near|part)\b/gi, ' ')
    .replace(/[^0-9A-Za-z\u0600-\u06FF]+/g, ' ');
  const leftoverDigits = /\d/.test(leftover);
  const leftoverWords = clean(leftover).replace(/\d+/g, '').trim();
  if (leftoverWords) notes.push(leftoverWords);
  if (/alive/i.test(raw)) notes.unshift('Alive');

  const dateNote = notes.filter(Boolean).join('; ') || null;
  const informative = hasYear || place !== null || cause !== null || event !== null || dateNote !== null;
  if (!informative && !leftoverDigits) {
    return {
      yearAh: null, yearAhAlt: null, yearCe: null, qualifier: null, place: null,
      dateNote: null, cause: null, event: null, raw, unparsed: false,
    };
  }

  return {
    yearAh, yearAhAlt, yearCe, qualifier, place, dateNote, cause, event, raw,
    unparsed: leftoverDigits,
  };
}
