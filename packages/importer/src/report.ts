import type { ParsedScholar } from './types.ts';

function pct(n: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((100 * n) / total)}%`;
}

export function buildReport(records: ParsedScholar[], failures: { id: number; message: string }[]): string {
  const total = records.length;
  const ids = new Set(records.map(record => record.id));
  const count = (pick: (record: ParsedScholar) => boolean) => records.filter(pick).length;
  const lines: string[] = [];
  lines.push('# Import report');
  lines.push('');
  lines.push(`Parsed **${total}** pages. Failed to parse **${failures.length}**.`);
  lines.push('');
  lines.push('## Coverage');
  lines.push('');
  lines.push('| Field | Pages | Share |');
  lines.push('|---|---:|---:|');
  const rows: [string, number][] = [
    ['Arabic name', count(record => Boolean(record.nameAr))],
    ['Famous name', count(record => Boolean(record.famousName))],
    ['Tabaqa', count(record => record.tabaqa !== null)],
    ['Madhhab', count(record => record.madhhab !== null)],
    ['Grade', count(record => record.grade !== null)],
    ['Birth year', count(record => record.birth?.yearAh !== null && record.birth?.yearAh !== undefined)],
    ['Death year', count(record => record.death?.yearAh !== null && record.death?.yearAh !== undefined)],
    ['Birth place', count(record => Boolean(record.birth?.place))],
    ['Death place', count(record => Boolean(record.death?.place))],
    ['Areas', count(record => record.areas.length > 0)],
    ['Rumuz', count(record => record.rumuz.length > 0)],
    ['Teachers or students', count(record => record.relations.some(relation => relation.type === 'teacher' || relation.type === 'student'))],
    ['Biography', count(record => Boolean(record.bioText))],
    ['Tahdheeb al-Kamal', count(record => Boolean(record.tk))],
    ['TK typed years', count(record => record.tk?.deathAh != null)],
    ['TK no entry', count(record => Boolean(record.tk?.noEntry))],
    ['Source entries', count(record => record.sources.length > 0)],
    ['Name variants', count(record => record.variants.length > 0)],
    ['Narration counts', count(record => record.narrations.length > 0)],
  ];
  for (const [label, n] of rows) lines.push(`| ${label} | ${n} | ${pct(n, total)} |`);

  const unparsed = new Map<string, number>();
  for (const record of records) {
    for (const date of [record.birth, record.death]) {
      if (date?.unparsed) unparsed.set(date.raw, (unparsed.get(date.raw) ?? 0) + 1);
    }
  }
  lines.push('');
  lines.push('## Unparsed dates');
  lines.push('');
  if (unparsed.size === 0) lines.push('None. Every non-empty birth and death string yielded a year, a place, a note, or the empty default.');
  else {
    lines.push(`${unparsed.size} distinct strings still contain a digit the grammar did not consume:`);
    lines.push('');
    for (const [raw, n] of [...unparsed].sort((a, b) => b[1] - a[1]).slice(0, 80)) lines.push(`- ${n} × \`${raw}\``);
  }

  const unidentified = records.filter(record => record.tk && !record.tk.noEntry && record.tk.kunya === null && record.tk.deathAh === null);
  lines.push('');
  lines.push('## Tahdheeb al-Kamal fields left untyped');
  lines.push('');
  lines.push(`${unidentified.length} entries with a block but no kunya and no year run. Showing up to 15 raw field lists.`);
  lines.push('');
  for (const record of unidentified.slice(0, 15)) {
    lines.push(`- ${record.id}: ${(record.tk?.rawFields ?? []).slice(0, 12).join(' | ')}`);
  }

  const missing = new Map<number, number>();
  for (const record of records) {
    for (const relation of record.relations) {
      if (relation.id !== null && !ids.has(relation.id)) missing.set(relation.id, (missing.get(relation.id) ?? 0) + 1);
    }
  }
  lines.push('');
  lines.push('## Links to ids that are not in this import');
  lines.push('');
  lines.push(`${missing.size} distinct ids. The most referenced:`);
  lines.push('');
  for (const [id, n] of [...missing].sort((a, b) => b[1] - a[1]).slice(0, 20)) lines.push(`- ${id} (${n})`);

  lines.push('');
  lines.push('## Quality flags');
  lines.push('');
  const flags = new Map<string, number>();
  for (const record of records) for (const flag of record.qualityFlags) flags.set(flag, (flags.get(flag) ?? 0) + 1);
  if (flags.size === 0) lines.push('None.');
  for (const [flag, n] of [...flags].sort((a, b) => b[1] - a[1])) lines.push(`- \`${flag}\`: ${n}`);

  if (failures.length) {
    lines.push('');
    lines.push('## Parse failures');
    lines.push('');
    for (const failure of failures.slice(0, 50)) lines.push(`- ${failure.id}: ${failure.message}`);
  }
  lines.push('');
  return lines.join('\n');
}
