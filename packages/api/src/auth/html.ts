const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ESCAPE[char] ?? char);
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1c1917;background:#fafaf9}
a{color:#9a3412} h1{font-size:1.6rem} table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #e7e5e4;padding:.45rem;text-align:left;vertical-align:top}
input,select,textarea,button{font:inherit;padding:.35rem .55rem} textarea{width:100%;min-height:8rem} code,pre{font-family:ui-monospace,monospace}
.nav{color:#57534e} .warn{background:#fff7ed;border:1px solid #fdba74;padding:.8rem} .error{color:#9f1239}
form.inline{display:inline}
</style></head><body>
<p class="nav"><a href="/docs">Docs</a> · <a href="/portal">Portal</a></p>
${body}</body></html>`;
}
