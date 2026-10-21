import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScholar, type ParsedScholar } from '../src/index.ts';

const goldenDir = fileURLToPath(new URL('./golden/', import.meta.url));

export async function golden(id: number): Promise<ParsedScholar> {
  return parseScholar(id, await readFile(join(goldenDir, `${id}.html`), 'utf8'));
}

export function scholar(partial: Pick<ParsedScholar, 'id' | 'nameEn' | 'category'> & Partial<ParsedScholar>): ParsedScholar {
  return {
    nameAr: null,
    honorificAr: null,
    shortName: null,
    famousName: null,
    fullName: null,
    tabaqa: null,
    madhhab: null,
    categoryNote: null,
    grade: null,
    gradeRaw: null,
    taqribVerdictAr: null,
    rumuz: [],
    areas: [],
    birth: null,
    death: null,
    places: [],
    relations: [],
    tags: [],
    bioText: null,
    bioLang: null,
    bioLink: null,
    sourceLastUpdated: null,
    qualityFlags: [],
    books: [],
    sections: {},
    variants: [],
    narrations: [],
    msdRefs: [],
    sources: [],
    tk: null,
    ...partial,
  };
}
