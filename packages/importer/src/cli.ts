import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadRecords, type LoadMode } from './load.ts';
import { parseScholar } from './parse/scholar.ts';
import { buildReport } from './report.ts';
import type { ParsedScholar } from './types.ts';

export async function readScholars(dir: string, log: (message: string) => void = () => {}): Promise<{ records: ParsedScholar[]; failures: { id: number; message: string }[] }> {
  const files = (await readdir(dir)).filter(file => file.endsWith('.html'));
  const records: ParsedScholar[] = [];
  const failures: { id: number; message: string }[] = [];
  let seen = 0;
  for (const file of files) {
    const id = Number(file.slice(0, -'.html'.length));
    if (!Number.isInteger(id)) continue;
    try {
      records.push(parseScholar(id, await readFile(join(dir, file), 'utf8')));
    } catch (error) {
      failures.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
    seen++;
    if (seen % 2000 === 0) log(`parsed ${seen}/${files.length}`);
  }
  records.sort((a, b) => a.id - b.id);
  return { records, failures };
}

async function main() {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf('--dir');
  const dir = resolve(dirFlag >= 0 ? args[dirFlag + 1] ?? '' : process.env.RAW_HTML_DIR ?? '');
  if (!dir) throw new Error('Set RAW_HTML_DIR or pass --dir');
  const mode: LoadMode = args.includes('--fill-empty') ? 'fill-empty' : 'replace';
  const reportPath = resolve(args.includes('--report') ? args[args.indexOf('--report') + 1] ?? 'import-report.md' : 'import-report.md');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  console.log(`Reading ${dir}`);
  const { records, failures } = await readScholars(dir, console.log);
  console.log(`Parsed ${records.length}, failed ${failures.length}. Loading (${mode})...`);
  await loadRecords(url, records, mode);
  const report = buildReport(records, failures);
  await writeFile(reportPath, report);
  console.log(`Wrote ${reportPath}`);
  const unparsed = (report.match(/## Unparsed dates\n\n([^\n]+)/) ?? [])[1] ?? '';
  console.log(unparsed);
}

if (import.meta.main) await main();
