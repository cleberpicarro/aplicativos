import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type Card } from './lib/api';
import { go, useRoute } from './lib/router';
import { STATUS, type StatusKey } from './lib/format';
import { Avatar, CardStatusIcon, Dialog, StatusIcon, TipIcon, useMe } from './components/ui';
import { Icon, type IconName } from './components/Icons';
import { CardModal } from './components/CardModal';
import { BoardsPage } from './pages/Boards';
import { InboxPage } from './pages/Inbox';
import { DelegatedPage } from './pages/Delegated';
import { NotificationsPage } from './pages/Notifications';
import { PeoplePage } from './pages/People';
import { ForgotPage, LoginPage, SetPasswordPage } from './pages/Auth';

const FS = [12, 13, 14, 15, 16, 18];
const FS_KEY = 'nerus.fs';

function useFontSize() {
  const [fs, setFs] = useState(() => {
    try {
      const v = Number(localStorage.getItem(FS_KEY));
      return FS.includes(v) ? v : 14;
    } catch {
      return 14;
    }
  });
  useEffect(() => {
    document.documentElement.style.setProperty('--fs', String(fs));
    try { localStorage.setItem(FS_KEY, String(fs)); } catch { /* sem armazenamento */ }
  }, [fs]);
  const i = FS.indexOf(fs);
  return { down: i > 0 ? () => setFs(FS[i - 1]) : undefined, up: i < FS.length - 1 ? () => setFs(FS[i + 1]) : undefined };
}

export function App() {
  const route = useRoute();
  const me = useMe();

  if (route.path === '/definir-senha') return <SetPasswordPage token={route.params.get('token') ?? ''} />;
  if (route.path === '/esqueci') return <ForgotPage />;
  if (me.isLoading) return <div className="auth"><p className="loading">Carregando…</p></div>;
  if (me.error || !me.data) return <LoginPage />;
  return <Shell />;
}

const PAGES: Record<string, { title: string }> = {
  '/quadros': { title: 'Meus quadros' },
  '/entrada': { title: 'Caixa de entrada' },
  '/delegadas': { title: 'Tarefas delegadas' },
  '/avisos': { title: 'Avisos' },
  '/pessoas': { title: 'Pessoas' },
};

function Shell() {
  const route = useRoute();
  const me = useMe().data!;
  const qc = useQueryClient();
  const font = useFontSize();
  const [legend, setLegend] = useState(false);
  const lastPage = useRef('/quadros');

  const hasReports = me.directReports.length > 0;
  const home = !me.user.inHierarchy ? '/pessoas' : hasReports ? '/delegadas' : '/quadros';
  let page = route.path;
  const cardCode = page.startsWith('/tarefa/') ? decodeURIComponent(page.slice(8)) : null;
  if (cardCode) page = lastPage.current;
  else if (!PAGES[page]) page = home;
  if (!cardCode) lastPage.current = page;

  useEffect(() => {
    if (!cardCode && !PAGES[route.path]) go(home);
  }, [route.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = `${cardCode ?? PAGES[page]?.title ?? ''} · Nerus Tasks`;
  }, [page, cardCode]);

  const nav: { path: string; label: string; icon: IconName; n?: number; attn?: boolean; show: boolean }[] = [
    { path: '/quadros', label: 'Meus quadros', icon: 'board', show: me.user.inHierarchy },
    { path: '/entrada', label: 'Caixa de entrada', icon: 'inbox', n: me.counts.inbox, show: me.user.inHierarchy },
    { path: '/delegadas', label: 'Tarefas delegadas', icon: 'users', n: me.counts.needAction, attn: true, show: hasReports },
    { path: '/avisos', label: 'Avisos', icon: 'bell', n: me.counts.unread, show: true },
    { path: '/pessoas', label: 'Pessoas', icon: 'shield', show: me.user.isAdmin },
  ];

  const logout = async () => {
    await post('/auth/logout');
    qc.clear();
    go('/entrar');
    window.location.reload();
  };

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><img src="/icon.svg" alt="" /><span>Nerus Tasks</span></div>
        <div className="who"><Avatar name={me.user.name} large /><div style={{ minWidth: 0 }}><b>{me.user.name}</b><small>{me.user.roleTitle}</small></div></div>
        <nav className="nav" aria-label="Principal">
          {nav.filter((n) => n.show).map((n) => (
            <a key={n.path} href={`#${n.path}`} aria-current={page === n.path ? 'page' : undefined}>
              <span className="ico"><Icon name={n.icon} /></span>
              <span>{n.label}</span>
              {!!n.n && <span className={`n${n.attn ? ' attn' : ''}`}>{n.n}</span>}
            </a>
          ))}
        </nav>
        <div className="foot">
          <button onClick={() => setLegend(true)}><span className="ico"><Icon name="help" /></span>Legenda</button>
          <button onClick={logout}><span className="ico"><Icon name="logout" /></span>Sair</button>
        </div>
      </aside>
      <main>
        <div className="tools" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
          {me.user.inHierarchy && <SearchBox />}
          <span className="seg" role="group" aria-label="Tamanho do texto">
            <button onClick={font.down} disabled={!font.down} aria-label="Diminuir texto">A−</button>
            <button onClick={font.up} disabled={!font.up} aria-label="Aumentar texto">A+</button>
          </span>
        </div>
        {page === '/quadros' && <BoardsPage />}
        {page === '/entrada' && <InboxPage />}
        {page === '/delegadas' && <DelegatedPage />}
        {page === '/avisos' && <NotificationsPage />}
        {page === '/pessoas' && <PeoplePage />}
      </main>
      {cardCode && <CardModal key={cardCode} code={cardCode} onClose={() => go(lastPage.current)} />}
      {legend && <LegendDialog onClose={() => setLegend(false)} />}
    </div>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const res = useQuery({
    queryKey: ['search', term],
    queryFn: () => get<{ byCode: (Card & { role: string }) | null; results: Card[] }>(`/search?q=${encodeURIComponent(term)}`),
    enabled: term.length > 0,
  });
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (code: string) => { setOpen(false); setQ(''); go(`/tarefa/${code}`); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = res.data;
    const first = d?.byCode ?? d?.results[0];
    if (first) pick(first.code);
  };
  const items = res.data ? (res.data.byCode ? [res.data.byCode] : res.data.results) : [];
  return (
    <div className="search" ref={ref}>
      <form onSubmit={submit} role="search">
        <input className="input" type="search" placeholder="Buscar tarefa ou código" aria-label="Buscar tarefa ou código" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
      </form>
      {open && term && (
        <div className="search-pop">
          {res.isLoading && <p className="hint">Buscando…</p>}
          {res.data && items.length === 0 && <p className="hint">Nada encontrado entre as tarefas que você pode ver.</p>}
          {items.map((c) => (
            <button key={c.id} onClick={() => pick(c.code)}>
              <CardStatusIcon card={c} />
              <span className="t">{c.title}</span>
              <span className="code">{c.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LegendDialog({ onClose }: { onClose: () => void }) {
  const keys: StatusKey[] = ['active', 'inbox', 'awaiting', 'declined', 'reopened', 'acked', 'canceled', 'done'];
  return (
    <Dialog title="Legenda" onClose={onClose}>
      <p className="hint">Passe o mouse ou toque em qualquer ícone para ver o significado.</p>
      <div className="legend">
        {keys.map((k) => <div key={k}><StatusIcon status={k} />{STATUS[k].label}</div>)}
        <div><TipIcon name="into" tip="Delegada por" />Delegada por alguém acima de você</div>
        <div><TipIcon name="out" tip="Repassada para" />Repassada para um subordinado</div>
        <div><TipIcon name="lock" tip="Privada" />Privada: nenhum superior vê</div>
        <div><span className="due late">3 out</span>Prazo atrasado</div>
        <div><span className="due today">hoje</span>Vence hoje</div>
        <div><span className="pill attn">âmbar</span>Precisa da sua ação</div>
      </div>
    </Dialog>
  );
}
