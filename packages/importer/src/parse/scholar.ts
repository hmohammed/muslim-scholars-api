import type { ParsedScholar, ScholarCategory } from '../types.ts';
import { parseBio } from './bio.ts';
import { parseDate } from './dates.ts';
import { parseGeneration, parseInterest, parseMadhhab } from './interest.ts';
import { parseRelations } from './people.ts';
import { parseBooks, parseMsdRefs, parseNarrations, parseSources } from './sources.ts';
import { field, hasArabic, labelledRows, text } from './text.ts';
import { parseTk } from './tk.ts';
import { tagKind } from '../tags.ts';

const HONORIFIC = /(\(?\s*)(رضي الله عنه|رضي الله عنها|رضي الله عنهم|رضی اللہ عنہ|صلى الله عليه(?: وسلم)?|ﷺ)\s*$/;
const KNOWN = new Set([
  'Scholar', 'Name', 'Full Name', 'Parents', 'Spouse(s)', 'Spouse', 'Siblings', 'Children',
  'Birth Date/Place', 'Death Date/Place', 'Places of Stay', 'Area of Interest',
  'Teachers/Narrated From', 'Students/Narrated By', 'Books/Work', 'Tags', 'Last Updated',
  'References', 'Narrations', 'Thadeeb al-Kamal', 'Brief Biography', 'Analysis',
]);

function splitHeader(header: string): { en: string; ar: string | null; honorific: string | null } {
  let value = header.trim();
  const honorificMatch = value.match(HONORIFIC);
  const honorific = honorificMatch?.[2] ?? null;
  if (honorificMatch?.index !== undefined) value = value.slice(0, honorificMatch.index).trim();
  const at = value.search(/[\u0600-\u06FF]/);
  if (at < 0) return { en: value.replace(/[\s(]+$/, '').trim(), ar: null, honorific };
  const ar = value.slice(at).replace(/^[(/\s]+/, '').trim();
  return { en: value.slice(0, at).replace(/[\s(]+$/, '').trim(), ar: ar || null, honorific };
}

function famousName(cell: string): { shortName: string; famous: string | null } {
  const body = cell.replace(/^\d+\s*-\s*/, '').trim();
  if (!body.endsWith(']')) return { shortName: body, famous: null };
  let depth = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i] === ']') depth++;
    else if (body[i] === '[') {
      depth--;
      if (depth === 0) {
        return { shortName: body.slice(0, i).trim(), famous: body.slice(i + 1, -1).trim() || null };
      }
    }
  }
  return { shortName: body, famous: null };
}

function categoryOf(cell: string): { category: ScholarCategory; tabaqa: number | null; madhhab: ReturnType<typeof parseMadhhab>; note: string | null } {
  const brackets = [...cell.matchAll(/\[([^[\]]*)\]/g)].map(match => match[1] ?? '');
  let tabaqa: number | null = null;
  let madhhab: ReturnType<typeof parseMadhhab> = null;
  const notes: string[] = [];
  for (const bracket of brackets) {
    const generation = parseGeneration(bracket);
    const school = parseMadhhab(bracket);
    if (generation) tabaqa = generation;
    else if (school && !/generation/i.test(bracket)) madhhab = school;
    else notes.push(bracket.trim());
  }
  const base = text(cell).replace(/\[[\s\S]*$/, '').trim();
  let category: ScholarCategory | null = null;
  const century = base.match(/(\d{1,2})\s*(?:st|nd|rd|th)\s+century/i);
  if (/rasool|prophet muhammad/i.test(base)) category = 'prophet';
  else if (/relative/i.test(base)) category = 'relative';
  else if (/comp\./i.test(base)) category = 'companion';
  else if (/succ|taba'\s*tabi/i.test(base)) category = 'successor';
  else if (/follower|\btabi/i.test(base)) category = 'follower';
  else if (century?.[1]) {
    const n = Number(century[1]);
    if (n >= 3 && n <= 15) category = `century_${n}` as ScholarCategory;
  }
  if (!category) throw new Error(`unrecognised category: ${base || cell}`);
  return { category, tabaqa, madhhab, note: notes.filter(Boolean).join('; ') || null };
}

function sourceDate(value: string | undefined): string | null {
  const match = value?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!match) return null;
  const [year, month, day] = match.split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(Date.UTC(year, (month ?? 1) - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return match;
}

function splitPlaces(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split('/').map(item => item.trim()).filter(item => item && item !== '-'))];
}

export function parseScholar(id: number, html: string): ParsedScholar {
  const headerRaw = text(html.match(/<th>\s*<font[^>]*>([\s\S]*?)<\/font>\s*<\/th>/i)?.[1] ?? '');
  const header = splitHeader(headerRaw);
  const scholarRow = html.match(/<b>(?:Scholar|Name):<\/b><\/td><td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/i);
  if (!scholarRow) throw new Error('no Scholar or Name row');
  const nameCell = text(scholarRow[1] ?? '');
  const { shortName, famous } = famousName(nameCell);
  const category = categoryOf(scholarRow[2] ?? '');
  const rows = labelledRows(html);

  const interest = parseInterest(field(rows, 'Area of Interest')?.html);
  const birth = parseDate(field(rows, 'Birth Date/Place')?.text, 'birth');
  const death = parseDate(field(rows, 'Death Date/Place')?.text, 'death');
  const bioDiv = html.match(new RegExp(`id=['"]bio${id}['"][^>]*>([\\s\\S]*?)</div>`, 'i'))?.[1];
  const bio = parseBio(bioDiv);
  const corrupt = id === 2;
  const references = field(rows, 'References')?.html;
  const parsedSources = corrupt
    ? { sources: [], variants: [] as string[], books: new Map<number, { nameEn: string | null; nameAr: string | null }>() }
    : parseSources(html, id, references, false);
  const tk = parseTk(html.match(new RegExp(`id=['"]kamal${id}['"][^>]*>([\\s\\S]*?)</div>`, 'i'))?.[1], id);

  const relations = [
    ...parseRelations('parent', field(rows, 'Parents')?.html),
    ...parseRelations('spouse', field(rows, 'Spouse(s)', 'Spouse')?.html),
    ...parseRelations('sibling', field(rows, 'Siblings')?.html),
    ...parseRelations('child', field(rows, 'Children')?.html),
    ...parseRelations('teacher', field(rows, 'Teachers/Narrated From')?.html),
    ...parseRelations('student', field(rows, 'Students/Narrated By')?.html),
  ];

  const tags = (field(rows, 'Tags')?.text ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => ({ name, kind: tagKind(name) }));

  const sections: Record<string, string> = {};
  for (const [label, value] of rows) {
    if (!KNOWN.has(label) && value.text) sections[label] = value.text;
  }

  const flags: string[] = [];
  if (!header.ar) flags.push('no_arabic_name');
  if (html.includes('\uFFFD') || nameCell.includes('\uFFFD')) flags.push('replacement_char');
  if (corrupt) flags.push('corrupt_sources');
  if (tk?.noEntry) flags.push('tk_no_entry');
  if (birth?.unparsed) flags.push('unparsed_birth');
  if (death?.unparsed) flags.push('unparsed_death');

  const variants = [
    ...parsedSources.variants.map(nameAr => ({ nameAr, origin: 'hadith_literature' as const })),
    ...(tk?.variants ?? []).map(nameAr => ({ nameAr, origin: 'tk' as const })),
  ].filter(variant => hasArabic(variant.nameAr) && variant.nameAr.length <= 120);
  const seen = new Set<string>();
  const uniqueVariants = variants.filter(variant => {
    const key = `${variant.origin}\0${variant.nameAr}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    id,
    nameEn: header.en || shortName || `Scholar ${id}`,
    nameAr: header.ar,
    honorificAr: header.honorific,
    shortName: shortName || null,
    famousName: famous,
    fullName: field(rows, 'Full Name')?.text || null,
    category: category.category,
    tabaqa: category.tabaqa,
    madhhab: category.madhhab,
    categoryNote: category.note,
    grade: interest.grade,
    gradeRaw: interest.gradeRaw,
    taqribVerdictAr: interest.verdict,
    rumuz: interest.rumuz,
    areas: interest.areas,
    birth,
    death,
    places: splitPlaces(field(rows, 'Places of Stay')?.text),
    relations,
    tags,
    bioText: bio.text,
    bioLang: bio.lang,
    bioLink: bio.link,
    sourceLastUpdated: sourceDate(field(rows, 'Last Updated')?.text),
    qualityFlags: flags,
    books: parseBooks(field(rows, 'Books/Work')?.html),
    sections,
    variants: uniqueVariants,
    narrations: parseNarrations(field(rows, 'Narrations')?.html),
    msdRefs: parseMsdRefs(references),
    sources: parsedSources.sources,
    tk,
  };
}
