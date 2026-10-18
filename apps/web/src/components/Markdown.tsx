import { useMemo, type MouseEvent } from 'react';
import { Marked } from 'marked';

// Item 51: os textos de docs/ (guia do usuário e especificação) aparecem na Ajuda.
// As imagens de docs/imagens entram no build com nome versionado (o cache do app não guarda uma versão velha).
const IMAGES = import.meta.glob('../../../../docs/imagens/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const imageUrl = (src: string) => {
  const name = src.split('/').pop() ?? '';
  const hit = Object.entries(IMAGES).find(([k]) => k.endsWith(`/${name}`));
  return hit ? hit[1] : src;
};

/** Âncora no estilo do GitHub, para os links do sumário da especificação continuarem valendo. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function makeParser() {
  const m = new Marked({ gfm: true });
  m.use({
    renderer: {
      heading({ tokens, depth, text }) {
        return `<h${depth} id="doc-${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      image({ href, text }) {
        return `<img src="${esc(imageUrl(href))}" alt="${esc(text)}" loading="lazy">`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (href.startsWith('#')) return `<a href="${esc(href)}" data-anchor="${esc(href.slice(1))}">${inner}</a>`;
        return `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;
      },
      table(token) {
        // Tabelas largas rolam de lado no celular, sem empurrar a página.
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const body = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
        return `<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      },
    },
  });
  return m;
}

/** Mostra um texto em Markdown que vem do próprio repositório (docs/). */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => makeParser().parse(source, { async: false }) as string, [source]);
  // Links do sumário (#1-contexto…) rolam até o título, sem mexer na rota do app (que usa o # da barra de endereço).
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a[data-anchor]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(`doc-${a.getAttribute('data-anchor')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
