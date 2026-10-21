import type { ParsedPerson, RelationType } from '../types.ts';
import { text } from './text.ts';

const LINK = /<a\b[^>]*submit=scholar[^>]*\bID=(\d+)[^>]*>([\s\S]*?)<\/a>/gi;

export function parsePeople(html: string | null | undefined): ParsedPerson[] {
  if (!html) return [];
  const people: ParsedPerson[] = [];
  const links = [...html.matchAll(LINK)];
  let cursor = 0;
  const pushGap = (chunk: string) => {
    const plain = text(chunk);
    if (!plain) return;
    for (const name of plain.split(/[,/]/)) {
      const trimmed = name.replace(/\s+/g, ' ').trim().replace(/^[-–—]+|[-–—]+$/g, '');
      if (trimmed && trimmed !== '-' && trimmed !== ',') people.push({ id: null, name: trimmed.slice(0, 300) });
    }
  };
  for (const link of links) {
    const index = link.index ?? 0;
    pushGap(html.slice(cursor, index));
    const name = text(link[2] ?? '');
    if (name) people.push({ id: Number(link[1]), name: name.slice(0, 300) });
    cursor = index + link[0].length;
  }
  pushGap(html.slice(cursor));
  return people;
}

export function parseRelations(
  type: RelationType,
  html: string | null | undefined,
): { id: number | null; name: string; type: RelationType; position: number }[] {
  return parsePeople(html).map((person, index) => ({ ...person, type, position: index + 1 }));
}
