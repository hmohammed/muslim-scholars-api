import type { HadithCollection, ParsedSource } from '../types.ts';
import { text } from './text.ts';

const COLLECTIONS: { re: RegExp; id: number; collection: HadithCollection }[] = [
  { re: /bukhari/i, id: 0, collection: 'bukhari' },
  { re: /muslim/i, id: 1, collection: 'muslim' },
  { re: /da'?ud|dawud/i, id: 2, collection: 'abu_dawud' },
  { re: /tirmidh/i, id: 3, collection: 'tirmidhi' },
  { re: /nasa/i, id: 4, collection: 'nasai' },
  { re: /majah/i, id: 5, collection: 'ibn_majah' },
];

export function parseNarrations(html: string | null | undefined): { collection: HadithCollection; count: number }[] {
  if (!html) return [];
  const counts: { collection: HadithCollection; count: number }[] = [];
  const re = /([^<>:]{3,40}):\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const label = text(match[1] ?? '');
    const href = match[2] ?? '';
    const body = text(match[3] ?? '');
    const known = COLLECTIONS.find(item => item.re.test(label));
    const idParam = href.match(/[?&]ID=(\d*)/i)?.[1];
    const rows = href.match(/[?&]Rows=(\d+)/i)?.[1];
    const count = Number(rows ?? (body && /^\d+$/.test(body) ? body : ''));
    if (!known || !Number.isFinite(count) || count <= 0) continue;
    if (idParam !== undefined && idParam !== '' && Number(idParam) !== known.id) continue;
    counts.push({ collection: known.collection, count });
  }
  return counts;
}

export function parseMsdRefs(html: string | null | undefined): { refNo: number; locator: string | null }[] {
  if (!html) return [];
  const head = html.split(/<a\b/i)[0] ?? html;
  const refs: { refNo: number; locator: string | null }[] = [];
  for (const match of head.matchAll(/(\d+)\s*\[([^\]]*)\]/g)) {
    refs.push({ refNo: Number(match[1]), locator: text(match[2] ?? '') || null });
  }
  return refs;
}

export function parseBooks(html: string | null | undefined): { id: number; title: string }[] {
  if (!html) return [];
  const books: { id: number; title: string }[] = [];
  const re = /<a\b[^>]*submit=book(?:&|&amp;)ID=(\d+)[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const title = text(match[2] ?? '');
    if (title && !/^add$/i.test(title)) books.push({ id: Number(match[1]), title });
  }
  return books;
}

interface LinkedSource {
  bookId: number;
  name: string;
  rid: number | null;
  locator: string | null;
}

function parseLinks(html: string): LinkedSource[] {
  const links: LinkedSource[] = [];
  const re = /<a\b[^>]*submit=AsabahView[^>]*vsource=(\d+)[^>]*\bID=(\d*)[^>]*>([\s\S]*?)<\/a>\s*(\[[^\]]*\])?/gi;
  for (const match of html.matchAll(re)) {
    const rid = match[2] ? Number(match[2]) : null;
    links.push({
      bookId: Number(match[1]),
      name: text(match[3] ?? ''),
      rid: rid && Number.isFinite(rid) ? rid : null,
      locator: match[4] ? text(match[4]).replace(/^\[|\]$/g, '') || null : null,
    });
  }
  return links;
}

interface HiddenSource {
  bookId: number;
  nameEn: string | null;
  nameAr: string | null;
  rid: number | null;
  locator: string | null;
  entryType: string | null;
  textAr: string | null;
  variants: string[];
}

function parseHidden(html: string, scholarId: number): HiddenSource[] {
  const div = html.match(new RegExp(`id=['"]hideshow${scholarId}['"][^>]*>([\\s\\S]*?)</div>`, 'i'))?.[1];
  if (!div) return [];
  const chunks = div.split(/<hr\s*\/?>/i);
  const variants: string[] = [];
  const first = chunks[0] ?? '';
  const names = first.split(/<br\s*\/?>/i).slice(1).join(' ');
  for (const name of text(names).split(/[,،]/)) {
    const trimmed = name.trim();
    if (trimmed) variants.push(trimmed);
  }
  const entries: HiddenSource[] = [];
  for (const chunk of chunks.slice(1)) {
    const header = chunk.match(/^([\s\S]*?)<br\s*\/?>/i);
    const body = header ? chunk.slice(header[0].length) : '';
    const title = text(header?.[1] ?? '');
    const bookId = Number(chunk.match(/vsource=(\d+)/i)?.[1] ?? '');
    const ridRaw = chunk.match(/\bRID=(\d*)/i)?.[1] ?? title.match(/Id:(\d*)/i)?.[1] ?? '';
    const rid = ridRaw ? Number(ridRaw) : null;
    const entryType = title.match(/\[([^,\]]*)/)?.[1]?.trim() || null;
    const locator = title.match(/pg:([^\]<]+)/i)?.[1]?.trim() || null;
    const [nameEn, nameAr] = title.split(/\s+-\s+/);
    if (!bookId) continue;
    entries.push({
      bookId,
      nameEn: nameEn?.replace(/\[[\s\S]*$/, '').trim() || null,
      nameAr: nameAr?.replace(/\[[\s\S]*$/, '').trim() || null,
      rid: rid && Number.isFinite(rid) ? rid : null,
      locator,
      entryType,
      textAr: text(body, true) || null,
      variants: [],
    });
  }
  if (entries[0]) entries[0].variants = variants;
  else if (variants.length) entries.push({
    bookId: 0, nameEn: null, nameAr: null, rid: null, locator: null, entryType: null, textAr: null, variants,
  });
  return entries;
}

export function parseSources(html: string, scholarId: number, referencesHtml: string | undefined, skipTexts: boolean): {
  sources: ParsedSource[];
  variants: string[];
  books: Map<number, { nameEn: string | null; nameAr: string | null }>;
} {
  const links = parseLinks(referencesHtml ?? '');
  const hidden = skipTexts ? [] : parseHidden(html, scholarId);
  const variants = hidden.flatMap(entry => entry.variants);
  const books = new Map<number, { nameEn: string | null; nameAr: string | null }>();
  const sources: ParsedSource[] = [];
  const used = new Set<number>();

  for (const link of links) {
    const hiddenIndex = hidden.findIndex((entry, index) =>
      !used.has(index) && entry.bookId === link.bookId && entry.rid === link.rid);
    const match = hiddenIndex >= 0 ? hidden[hiddenIndex] : undefined;
    if (hiddenIndex >= 0) used.add(hiddenIndex);
    if (match?.nameEn || match?.nameAr) books.set(link.bookId, { nameEn: match.nameEn, nameAr: match.nameAr });
    sources.push({
      bookId: link.bookId,
      bookName: match?.nameEn ?? link.name,
      bookNameAr: match?.nameAr ?? null,
      rid: link.rid,
      locator: match?.locator ?? link.locator,
      entryType: match?.entryType ?? null,
      textAr: link.rid === null ? null : match?.textAr ?? null,
    });
  }
  for (const [index, entry] of hidden.entries()) {
    if (used.has(index) || entry.bookId === 0) continue;
    if (entry.nameEn || entry.nameAr) books.set(entry.bookId, { nameEn: entry.nameEn, nameAr: entry.nameAr });
    sources.push({
      bookId: entry.bookId,
      bookName: entry.nameEn,
      bookNameAr: entry.nameAr,
      rid: entry.rid,
      locator: entry.locator,
      entryType: entry.entryType,
      textAr: entry.textAr,
    });
  }
  return { sources, variants, books };
}
