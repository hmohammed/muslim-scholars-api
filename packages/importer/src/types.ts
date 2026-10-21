export type ScholarCategory =
  | 'prophet' | 'companion' | 'follower' | 'successor' | 'relative'
  | 'century_3' | 'century_4' | 'century_5' | 'century_6' | 'century_7'
  | 'century_8' | 'century_9' | 'century_10' | 'century_11' | 'century_12'
  | 'century_13' | 'century_14' | 'century_15';

export type Madhhab = 'hanafi' | 'shafii' | 'maliki' | 'hanbali' | 'other';
export type ScholarGrade =
  | 'Thiqah' | 'Maqbool' | 'Sadooq' | 'Unknown-Majhool' | 'Weak' | 'Sadooq/Delusion'
  | 'Abandoned' | 'No Doubt' | 'Thiqah Thiqah' | 'Not Thiqah' | 'Undefined' | 'Liar' | 'Accused Liar';
export type DateQualifier = 'exact' | 'approx' | 'before' | 'after' | 'between' | 'or';
export type DeathCause = 'natural' | 'killed' | 'martyred' | 'plague' | 'poisoned';
export type BioLang = 'ar' | 'en' | 'mixed';
export type RelationType = 'teacher' | 'student' | 'parent' | 'child' | 'sibling' | 'spouse';
export type HadithCollection = 'bukhari' | 'muslim' | 'abu_dawud' | 'tirmidhi' | 'nasai' | 'ibn_majah';
export type NameOrigin = 'hadith_literature' | 'tk';
export type TagKind = 'tribe' | 'clan' | 'nisba' | 'battle' | 'gender' | 'era' | 'other';

export interface ParsedPerson {
  id: number | null;
  name: string;
}

export interface ParsedRelation extends ParsedPerson {
  type: RelationType;
  position: number;
}

export interface ParsedSource {
  bookId: number;
  bookName: string | null;
  bookNameAr: string | null;
  rid: number | null;
  locator: string | null;
  entryType: string | null;
  textAr: string | null;
}

export interface ParsedTk {
  tkNo: number | null;
  kunya: string | null;
  nisba: string | null;
  rank: string | null;
  tabaqa: number | null;
  deathAh: number | null;
  birthAh: number | null;
  age: number | null;
  countries: string | null;
  deathPlace: string | null;
  rawFields: string[];
  textAr: string | null;
  noEntry: boolean;
  /** Arabic name-like fields kept as name variants. */
  variants: string[];
}

export interface ParsedScholar {
  id: number;
  nameEn: string;
  nameAr: string | null;
  honorificAr: string | null;
  shortName: string | null;
  famousName: string | null;
  fullName: string | null;
  category: ScholarCategory;
  tabaqa: number | null;
  madhhab: Madhhab | null;
  categoryNote: string | null;
  grade: ScholarGrade | null;
  gradeRaw: string | null;
  taqribVerdictAr: string | null;
  rumuz: string[];
  areas: string[];
  birth: import('./parse/dates.ts').ParsedDate | null;
  death: import('./parse/dates.ts').ParsedDate | null;
  places: string[];
  relations: ParsedRelation[];
  tags: { name: string; kind: TagKind }[];
  bioText: string | null;
  bioLang: BioLang | null;
  bioLink: string | null;
  sourceLastUpdated: string | null;
  qualityFlags: string[];
  books: { id: number; title: string }[];
  sections: Record<string, string>;
  variants: { nameAr: string; origin: NameOrigin }[];
  narrations: { collection: HadithCollection; count: number }[];
  msdRefs: { refNo: number; locator: string | null }[];
  sources: ParsedSource[];
  tk: ParsedTk | null;
}
