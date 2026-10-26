import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../lib/api';
import { STATUS, daysBetween, delegationKey, fullDate, statusOf } from '../lib/format';
import { Icon } from './Icons';
import { Linked } from './Linked';

/* Item 61: parar o mouse 0,5 s sobre o cartão abre um balão com a tarefa completa (título, descrição,
   com quem está, prazo e checklist). Só no computador; mostra só o que o quadro já tem, sem esperar o servidor.
   Itens 70 e 71: o balão fica aberto enquanto o mouse vai do cartão até ele, e tem links clicáveis e um botão de copiar. */

const DELAY = 500;
const WIDTH = 320;
const GAP = 8;
/** Tempo para o mouse atravessar o espaço entre o cartão e o balão sem ele sumir. */
const GRACE = 300;

/** Enquanto um cartão é arrastado, nenhum balão abre (vale para todos os cartões). */
let dragActive = false;
export const setDragActive = (on: boolean) => { dragActive = on; };

const canHover = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

export function usePeek(ref: RefObject<HTMLElement>, disabled: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<number>();
  const leave = useRef<number>();
  const close = () => { window.clearTimeout(timer.current); window.clearTimeout(leave.current); setRect(null); };
  const arm = () => {
    window.clearTimeout(timer.current);
    if (disabled || dragActive || !canHover()) return;
    timer.current = window.setTimeout(() => { if (!dragActive && ref.current) setRect(ref.current.getBoundingClientRect()); }, DELAY);
  };
  useEffect(() => {
    if (!rect) return;
    // Rolar a fase ou a página, ou apertar uma tecla, fecha o balão.
    // Ctrl+C (ou Cmd+C) num texto selecionado no balão não fecha.
    const key = (e: KeyboardEvent) => { if (!e.ctrlKey && !e.metaKey) close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', key, true); };
  }, [rect]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(leave.current); }, []);
  return {
    rect,
    close,
    handlers: {
      // O balão é filho do cartão no React: entrar nele conta como continuar no cartão.
      onMouseEnter: () => { window.clearTimeout(leave.current); if (!rect) arm(); },
      // “Mouse parado”: cada movimento recomeça a contagem até o balão abrir.
      onMouseMove: () => { if (!rect) arm(); },
      onMouseLeave: () => { window.clearTimeout(timer.current); window.clearTimeout(leave.current); leave.current = window.setTimeout(() => setRect(null), GRACE); },
      onMouseDown: close,
    },
  };
}

function dueText(date: string, today: string, done: boolean) {
  const n = daysBetween(today, date);
  if (done || n > 1) return `Prazo: ${fullDate(date)}${!done && n > 1 ? ` (em ${n} dias)` : ''}`;
  if (n === 1) return `Prazo: amanhã (${fullDate(date)})`;
  if (n === 0) return 'Prazo: hoje';
  return `Prazo: ${fullDate(date)}, atrasada há ${-n} ${n === -1 ? 'dia' : 'dias'}`;
}

export function CardPeek({ card, rect, today }: { card: Card; rect: DOMRect; today: string }) {
  const box = useRef<HTMLDivElement>(null);
  const desc = useRef<HTMLParagraphElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [cut, setCut] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  // Item 71: copia a descrição, ou o título se a tarefa não tiver descrição.
  const copy = async () => {
    const text = card.description.trim() ? card.description : card.title;
    if (!(await copyText(text))) return;
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    let left = rect.right + GAP;
    if (left + WIDTH > window.innerWidth - GAP) left = rect.left - GAP - WIDTH;
    left = Math.max(GAP, left);
    const top = Math.max(GAP, Math.min(rect.top, window.innerHeight - h - GAP));
    setPos({ top, left });
    if (desc.current) setCut(desc.current.scrollHeight > desc.current.clientHeight + 1);
  }, [rect]);

  const d = card.delegation;
  const child = card.child && card.child.status !== 'CANCELED' ? card.child : null;
  const done = !!card.completedAt;
  const lines: { text: string; late?: boolean }[] = [];
  if (d) lines.push({ text: `Delegada por ${d.delegatorName} · ${STATUS[statusOf(card)].label}` });
  if (child) lines.push({ text: `Repassada para ${child.ownerName} · ${STATUS[delegationKey(child.status, child.reopened)].label}` });
  if (card.transferredFrom) lines.push({ text: `Transferida por ${card.transferredFrom.name}` });
  if (done && !d) lines.push({ text: 'Concluída' });
  if (card.dueDate) lines.push({ text: dueText(card.dueDate, today, done), late: !done && daysBetween(today, card.dueDate) < 0 });
  if (card.checklist.total > 0) lines.push({ text: `Checklist: ${card.checklist.done} de ${card.checklist.total} feitos` });
  if (card.isPrivate) lines.push({ text: 'Privada: nenhum superior vê' });

  return createPortal(
    // Clicar no balão (num link, no copiar ou para selecionar texto) não fecha o balão nem começa a arrastar o cartão.
    <div ref={box} className="peek" role="tooltip" onMouseDown={(e) => e.stopPropagation()}
      style={pos ? { top: pos.top, left: pos.left, width: WIDTH } : { top: -9999, left: -9999, width: WIDTH }}>
      <div className="peek-h">
        <b className="peek-t"><Linked text={card.title} /></b>
        <button type="button" className={`peek-copy${copied ? ' on' : ''}`} onClick={copy}
          aria-label={card.description.trim() ? 'Copiar a descrição' : 'Copiar o título'}>
          <Icon name={copied ? 'check' : 'copy'} />{copied && <span>Copiado</span>}
        </button>
      </div>
      {card.description.trim() && <p ref={desc} className="peek-d"><Linked text={card.description} /></p>}
      {cut && <p className="peek-more">Abra a tarefa para ver o resto.</p>}
      {lines.length > 0 && (
        <ul className="peek-l">
          {lines.map((l) => <li key={l.text} className={l.late ? 'late' : undefined}>{l.text}</li>)}
        </ul>
      )}
    </div>,
    document.body,
  );
}

/** Copia para a área de transferência; sem a API do navegador (página sem https), usa o jeito antigo. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

/* Item 60: a linha de marcas do cartão tem altura de uma linha só. As marcas opcionais (data-opt: checklist,
   privada, “não pode ser repassada”) saem da direita para a esquerda até caber, e viram um “+N” discreto. */
export function useFitMeta(ref: RefObject<HTMLElement>, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const opts = [...el.querySelectorAll<HTMLElement>('[data-opt]')];
      const more = el.querySelector<HTMLElement>('.more');
      if (!more) return;
      // Mede com as etiquetas De/Para no tamanho cheio: elas só encolhem (com “…”) se nem as marcas importantes couberem.
      el.classList.add('measuring');
      el.classList.remove('tight');
      opts.forEach((o) => { o.style.display = ''; });
      more.style.display = 'none';
      const hidden: string[] = [];
      for (let i = opts.length - 1; i >= 0 && el.scrollWidth > el.clientWidth + 1; i--) {
        opts[i].style.display = 'none';
        hidden.unshift(opts[i].dataset.opt!);
        more.textContent = `+${hidden.length}`;
        more.style.display = '';
      }
      if (hidden.length) more.dataset.tip = hidden.join(' · ');
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('tight');
      el.classList.remove('measuring');
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
