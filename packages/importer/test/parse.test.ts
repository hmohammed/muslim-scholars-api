import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReport, parseDate, parseScholar } from '../src/index.ts';
import { parseTk } from '../src/parse/tk.ts';
import { golden } from './fixture.ts';

describe('date grammar', () => {
  it('parses every surveyed birth and death string', async () => {
    const examples = JSON.parse(await readFile(fileURLToPath(new URL('./date-examples.json', import.meta.url)), 'utf8')) as string[];
    expect(examples.length).toBeGreaterThan(200);
    const unparsed = examples.filter(example => parseDate(example, 'birth')?.unparsed || parseDate(example, 'death')?.unparsed);
    expect(unparsed).toEqual([]);
  });

  it('keeps the surveyed shapes that are easy to get wrong', () => {
    expect(parseDate('80 AH/699 CE (Kufa, Iraq)', 'birth')).toMatchObject({ yearAh: 80, yearCe: 699, qualifier: 'exact', place: 'Kufa, Iraq', unparsed: false });
    expect(parseDate('41 BH', 'birth')).toMatchObject({ yearAh: -41, qualifier: 'exact', unparsed: false });
    expect(parseDate('()[ Natural ]', 'death')).toMatchObject({ yearAh: null, place: null, cause: null, unparsed: false });
    expect(parseDate('~128', 'death')).toMatchObject({ yearAh: 128, qualifier: 'approx', unparsed: false });
    expect(parseDate('105 AH or 95 AH', 'birth')).toMatchObject({ yearAh: 105, yearAhAlt: 95, qualifier: 'or', unparsed: false });
    expect(parseDate('50-60 AH', 'birth')).toMatchObject({ yearAh: 50, yearAhAlt: 60, qualifier: 'between', unparsed: false });
    expect(parseDate('after 120 AH', 'death')).toMatchObject({ yearAh: 120, qualifier: 'after', unparsed: false });
    expect(parseDate('(Makran (India))[ Martyred ]', 'death')).toMatchObject({ place: 'Makran (India)', cause: 'martyred', unparsed: false });
    expect(parseDate('Alive ()[ Natural ]', 'death')).toMatchObject({ cause: null, dateNote: 'Alive', unparsed: false });
    expect(parseDate('10 AH [Martyred (Badr)]', 'death')).toMatchObject({ cause: 'martyred', event: 'Badr', unparsed: false });
    expect(parseDate('28 Muharram 1429/Feb 5, 2008', 'death')).toMatchObject({ yearAh: 1429, yearCe: 2008, unparsed: false });
    expect(parseDate('4 AH/626', 'birth')).toMatchObject({ yearAh: 4, yearCe: 626, unparsed: false });
    expect(parseDate('256 AH/870 CE (Samarqand)[ Natural ]', 'death')).toMatchObject({ yearAh: 256, yearCe: 870, place: 'Samarqand', cause: 'natural', unparsed: false });
  });
});

describe('golden pages', () => {
  it('reads a two-word kunya such as Abu Abdullah', () => {
    const html = '1427<br>زبير بن العوام<br>أبو عبد الله<br>المدني, الأسدي<br>صحابي<br>1';
    expect(parseTk(html, 7)).toMatchObject({ tkNo: 1427, kunya: 'أبو عبد الله', rank: 'صحابي' });
  });
  it('parses the Prophet, including before-Hijra dates and slash-separated parents', async () => {
    const row = await golden(1);
    expect(row.nameEn).toBe('Prophet Muhammad(saw)');
    expect(row.nameAr).toContain('محمّد');
    expect(row.honorificAr).toBe('رضي الله عنه');
    expect(row.category).toBe('prophet');
    expect(row.birth).toMatchObject({ yearAh: -53, yearCe: 570, place: 'Makkah' });
    expect(row.death).toMatchObject({ yearAh: 11, yearCe: 632, place: 'Medina', cause: 'natural' });
    expect(row.relations.filter(relation => relation.type === 'parent').map(relation => relation.name)).toEqual([
      "'Abdullah ibn 'Abd al-Muttalib",
      "Amina bint Wahb b 'Abd Munaf bin Zuhrah",
    ]);
    expect(row.bioLang).toBe('en');
    expect(row.tags).toContainEqual({ name: 'Quraish', kind: 'tribe' });
    expect(row.tags).toContainEqual({ name: 'B.Hashim', kind: 'clan' });
    expect(row.tags).toContainEqual({ name: 'Badr', kind: 'battle' });
  });

  it('imports Abu Bakr without the corrupt source dump and still reads Tahdheeb al-Kamal', async () => {
    const row = await golden(2);
    expect(row.category).toBe('companion');
    expect(row.tabaqa).toBe(1);
    expect(row.qualityFlags).toContain('corrupt_sources');
    expect(row.sources).toEqual([]);
    expect(row.tk).toMatchObject({ kunya: 'أبو بكر', rank: 'صحابي', noEntry: false });
    expect(row.birth?.yearAh).toBe(-51);
  });

  it('parses Umar, including narration counts', async () => {
    const row = await golden(3);
    expect(row.death).toMatchObject({ yearAh: 23, yearCe: 645, place: 'Medinah', cause: 'martyred' });
    expect(row.narrations).toEqual([
      { collection: 'bukhari', count: 95 },
      { collection: 'muslim', count: 43 },
      { collection: 'abu_dawud', count: 59 },
      { collection: 'tirmidhi', count: 61 },
      { collection: 'nasai', count: 61 },
      { collection: 'ibn_majah', count: 61 },
    ]);
    expect(row.sources.length).toBeGreaterThan(0);
  });

  it('parses Abu Hanifa grades, rumuz and a confident Tahdheeb al-Kamal row', async () => {
    const row = await golden(11001);
    expect(row).toMatchObject({
      nameEn: 'Abu Hanifa',
      category: 'follower',
      tabaqa: 6,
      grade: 'Thiqah',
      rumuz: ['ت', 'س'],
    });
    expect(row.birth).toMatchObject({ yearAh: 80, yearCe: 699, place: 'Kufa, Iraq' });
    expect(row.death).toMatchObject({ yearAh: 150, yearCe: 767, place: 'Baghdad', cause: 'natural' });
    expect(row.tk).toMatchObject({
      tkNo: 1734, kunya: 'أبو حنيفة', rank: 'الفقيه', tabaqa: 6,
      deathAh: 150, birthAh: 80, age: 70, countries: 'العراق, الكوفة', deathPlace: 'بغداد',
    });
    expect(row.sources.filter(source => source.textAr).length).toBe(7);
    expect(row.narrations).toEqual([]);
  });

  it('keeps a nested famous name and the Arabic verdict', async () => {
    const row = await golden(14110);
    expect(row.famousName).toBe('Abu Nasr [أبو نصر]');
    expect(row.grade).toBe('Maqbool');
    expect(row.taqribVerdictAr).toBe('لين الحديث');
    expect(row.death?.cause).toBeNull();
  });

  it('reads madhhab from the category bracket', async () => {
    const yusuf = await golden(20003);
    const muhammad = await golden(20004);
    const zufr = await golden(21262);
    const muslim = await golden(30003);
    const tabari = await golden(40010);
    expect(yusuf).toMatchObject({ category: 'successor', madhhab: 'hanafi', grade: 'No Doubt' });
    expect(yusuf.qualityFlags).toContain('tk_no_entry');
    expect(yusuf.tk).toMatchObject({ noEntry: true, deathAh: 182, birthAh: 113, age: 69 });
    expect(muhammad).toMatchObject({ category: 'successor', madhhab: 'hanafi', grade: 'Thiqah' });
    expect(muhammad.narrations).toEqual([{ collection: 'abu_dawud', count: 3 }, { collection: 'ibn_majah', count: 3 }]);
    expect(zufr.birth).toMatchObject({ yearAh: 110, qualifier: 'approx' });
    expect(zufr.death).toMatchObject({ yearAh: 158, place: 'Basra' });
    expect(zufr.madhhab).toBe('hanafi');
    expect(muslim).toMatchObject({ category: 'century_3', madhhab: 'shafii', grade: 'No Doubt', taqribVerdictAr: 'ثقة حافظ' });
    expect(muslim.birth).toMatchObject({ yearAh: 206, yearAhAlt: 202, qualifier: 'or' });
    expect(muslim.qualityFlags).toContain('replacement_char');
    expect(tabari).toMatchObject({ category: 'century_4', madhhab: 'other' });
    expect(tabari.tk).toMatchObject({ noEntry: true, tabaqa: 13, deathAh: 310, birthAh: 224, age: 86 });
  });

  it('parses al-Bukhari', async () => {
    const row = await golden(30001);
    expect(row.nameEn).toBe('al-Bukhari');
    expect(row.nameAr).toBe('محمد بن اسماعيل البخاري');
    expect(row).toMatchObject({ category: 'century_3', tabaqa: 11, madhhab: 'shafii', grade: 'No Doubt', taqribVerdictAr: 'ثقة حافظ' });
    expect(row.birth).toMatchObject({ yearAh: 194, yearCe: 810, place: 'Bukhara' });
    expect(row.death).toMatchObject({ yearAh: 256, yearCe: 870, place: 'Samarqand', cause: 'natural' });
    expect(row.relations.filter(relation => relation.type === 'teacher').length).toBeGreaterThan(100);
    expect(row.tk).toBeNull();
  });

  it('flags a page with no Arabic name and drops an impossible last-updated date', () => {
    const html = `<table><tr><th><font>Some Person</font></th></tr>
      <tr><td><b>Scholar:</b></td><td>99 - Some Person</td><td>3rd Century</td></tr>
      <tr><td><b>Last Updated:</b></td><td colspan=2>0000-00-00</td></tr></table>`;
    const row = parseScholar(99, html);
    expect(row.category).toBe('century_3');
    expect(row.nameAr).toBeNull();
    expect(row.qualityFlags).toContain('no_arabic_name');
    expect(row.sourceLastUpdated).toBeNull();
  });

  it('writes a quality report with no unparsed dates for the golden set', async () => {
    const ids = [1, 2, 3, 11001, 14110, 20003, 20004, 21262, 30001, 30003, 40010];
    const records = await Promise.all(ids.map(id => golden(id)));
    const report = buildReport(records, []);
    expect(report).toContain('## Unparsed dates');
    expect(report).toContain('None.');
    expect(report).toContain('corrupt_sources');
  });
});
