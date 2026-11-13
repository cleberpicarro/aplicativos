import { splitLinks } from '../lib/links';

/** Item 70: mostra o texto com os endereços e e-mails clicáveis, abrindo numa aba nova. */
export function Linked({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) => p.href
        ? <a key={i} className="tlink" href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
        : p.text)}
    </>
  );
}
