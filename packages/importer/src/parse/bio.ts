import type { BioLang } from '../types.ts';
import { hasArabic, text } from './text.ts';

export function parseBio(html: string | null | undefined): { text: string | null; lang: BioLang | null; link: string | null } {
  if (!html) return { text: null, lang: null, link: null };
  const link = [...html.matchAll(/<a\b[^>]*href=['"](https?:[^'"]+)['"][^>]*>/gi)]
    .map(match => match[1])
    .filter((href): href is string => Boolean(href))
    .at(-1) ?? null;

  const markdown = text(
    html
      .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n${'#'.repeat(Number(level))} `)
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<(b|strong)>/gi, '**')
      .replace(/<\/(b|strong)>/gi, '**')
      .replace(/<(i|em)>/gi, '*')
      .replace(/<\/(i|em)>/gi, '*')
      .replace(/<a\b[^>]*href=['"](https?:[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) =>
        `[${text(label) || href}](${href})`),
    true,
  ).replace(/\n{3,}/g, '\n\n').trim();

  if (!markdown) return { text: null, lang: null, link };
  const arabic = hasArabic(markdown);
  const latin = /[A-Za-z]/.test(markdown);
  const lang: BioLang = arabic && latin ? 'mixed' : arabic ? 'ar' : 'en';
  return { text: markdown, lang, link };
}
