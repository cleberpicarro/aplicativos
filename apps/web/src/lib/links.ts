/* Item 70: endereços (http://, https://, www.) e e-mails no texto viram links. O texto gravado não muda. */

export type Piece = { text: string; href?: string };

const FIND = /(\bhttps?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;
const TRAIL = /[.,;:!?'"”’»]+$/;

/** Tira do fim do endereço a pontuação da frase (“veja https://x.com.”) e o “)” que não abriu dentro dele. */
function trim(url: string) {
  let u = url;
  for (;;) {
    const before = u;
    u = u.replace(TRAIL, '');
    for (const [open, close] of [['(', ')'], ['[', ']']]) {
      if (u.endsWith(close) && u.split(open).length < u.split(close).length) u = u.slice(0, -1);
    }
    if (u === before) return u;
  }
}

/** Só http, https e mailto viram link (nada de javascript: e parecidos). */
function hrefOf(text: string): string | undefined {
  const raw = /^www\./i.test(text) ? `https://${text}` : /^https?:\/\//i.test(text) ? text : `mailto:${text}`;
  try {
    const u = new URL(raw);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function splitLinks(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  const push = (t: string) => { if (!t) return; const p = out[out.length - 1]; if (p && !p.href) p.text += t; else out.push({ text: t }); };
  for (const m of text.matchAll(FIND)) {
    const start = m.index!;
    const found = trim(m[0]);
    const href = found.includes('.') || found.includes('://') ? hrefOf(found) : undefined;
    if (!href || /^https?:\/\/$/i.test(found)) continue;
    push(text.slice(last, start));
    out.push({ text: found, href });
    last = start + found.length;
  }
  push(text.slice(last));
  return out;
}
