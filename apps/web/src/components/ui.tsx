import { createContext, Fragment, type InputHTMLAttributes, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, type Card, type Me } from '../lib/api';
import { STATUS, daysBetween, fullDate, initials, shortDate, statusOf, type StatusKey } from '../lib/format';
import { Icon, type IconName } from './Icons';

/* ---------- sessão ---------- */
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/me'), retry: false, refetchInterval: 60_000 });
}

/* ---------- avisos flutuantes ---------- */
/** Ação opcional no aviso, como o “Desfazer” do arquivar (item 23). */
export type ToastAction = { label: string; onClick: () => void };
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'error', action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: string; action?: ToastAction } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((msg: string, kind: 'ok' | 'error' = 'ok', action?: ToastAction) => {
    setT({ msg, kind, action });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), kind === 'error' ? 5000 : action ? 7000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">
        {t && (
          <div className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            {t.msg}
            {t.action && (
              <button className="toast-act" onClick={() => { const a = t.action!; setT(null); a.onClick(); }}>{t.action.label}</button>
            )}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- elementos ---------- */
export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return (
    <span className={`av${large ? ' lg' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function TipIcon({ name, tip, tone = '' }: { name: IconName; tip: string; tone?: '' | 'attn' | 'late' }) {
  return (
    <span className={`ico tip ${tone}`} data-tip={tip} tabIndex={0} role="img" aria-label={tip}>
      <Icon name={name} />
    </span>
  );
}

const STATUS_ICON: Record<StatusKey, IconName> = {
  own: 'clock', inbox: 'inbox', active: 'clock', reopened: 'refresh', awaiting: 'hourglass',
  declined: 'undo', acked: 'archive', canceled: 'xc', done: 'check', archived: 'archive',
};

export function StatusIcon({ status }: { status: StatusKey }) {
  const s = STATUS[status];
  return <TipIcon name={STATUS_ICON[status]} tip={s.tip} tone={s.tone} />;
}

export function StatusPill({ status }: { status: StatusKey }) {
  const s = STATUS[status];
  return (
    <span className={`pill ${s.tone}`}>
      <Icon name={STATUS_ICON[status]} />
      {s.label}
    </span>
  );
}

export function CardStatusIcon({ card }: { card: Card }) {
  return <StatusIcon status={statusOf(card)} />;
}

export function Due({ date, done, today }: { date: string | null; done?: boolean; today: string }) {
  if (!date) return <span className="due" />;
  const n = daysBetween(today, date);
  if (done) return <span className="due" data-tip={`Prazo era ${fullDate(date)}`} tabIndex={0}>{shortDate(date)}</span>;
  if (n < 0) return <span className="due late" data-tip={`Atrasada há ${-n} ${-n === 1 ? 'dia' : 'dias'}`} tabIndex={0}>{shortDate(date)}</span>;
  if (n === 0) return <span className="due today" data-tip="Vence hoje" tabIndex={0}>hoje</span>;
  return <span className="due" data-tip={`Vence em ${n} ${n === 1 ? 'dia' : 'dias'} (${fullDate(date)})`} tabIndex={0}>{shortDate(date)}</span>;
}

/* ---------- diálogo ---------- */
export function Dialog({ title, onClose, children, footer, wide, label }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not(.x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`dialog${wide ? ' card' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
        <div className="dialog-h">
          <h3>{title}</h3>
          <button className="b ghost icon x" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
        </div>
        <div className="dialog-b">{children}</div>
        {footer && <div className="dialog-f">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- menu simples ---------- */
export function Menu({ label, items }: { label: string; items: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; separator?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="b ghost icon sm" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="dots" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) => (
            <Fragment key={it.label}>
              {it.separator && <hr className="menu-sep" />}
              <button role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>
                {it.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Campo de senha com o botão de olho para mostrar ou ocultar o que foi digitado. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input {...props} type={visible ? 'text' : 'password'} className="input" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        className="password-eye"
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={visible}
        title={visible ? 'Ocultar senha' : 'Mostrar senha'}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="err" role="alert">{(error as Error).message}</p>;
}
