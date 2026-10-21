const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

export function text(html: string | null | undefined, keepLines = false): string {
  if (!html) return '';
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    })
    .replace(/[\u200E\u200F\uFEFF]/g, '');
  s = keepLines
    ? s.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n')
    : s.replace(/\s+/g, ' ');
  return s.trim();
}

export function hasArabic(s: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s);
}

/** Labelled rows: `<td><b>Label:</td><td colspan=2>value`. */
export function labelledRows(html: string): Map<string, { html: string; text: string }> {
  const rows = new Map<string, { html: string; text: string }>();
  const re = /<td[^>]*>\s*<b>([^<]*(?:<br>[^<]*)?)<\/(?:b|td|th)>(?:<\/td>)?\s*<td colspan=2[^>]*>([\s\S]*?)(?=<\/td>|<tr\b)/gi;
  for (const match of html.matchAll(re)) {
    const rawLabel = match[1] ?? '';
    const value = match[2] ?? '';
    const label = rawLabel
      .replace(/<br\s*\/?>/gi, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/:\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (label && !rows.has(label)) rows.set(label, { html: value, text: text(value) });
  }
  return rows;
}

export function field(rows: Map<string, { html: string; text: string }>, ...labels: string[]) {
  for (const label of labels) {
    const found = rows.get(label);
    if (found) return found;
  }
  return undefined;
}
