import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type Card } from './lib/api';
import { go, useRoute } from './lib/router';
import { STATUS, cardNo, type StatusKey } from './lib/format';
import { Avatar, CardStatusIcon, Dialog, StatusIcon, TipIcon, useMe } from './components/ui';
import { Icon, type IconName } from './components/Icons';
import { CardModal } from './components/CardModal';
import { BoardsPage, rememberedBoard } from './pages/Boards';
import { InboxPage } from './pages/Inbox';
import { DelegatedPage } from './pages/Delegated';
import { NotificationsPage } from './pages/Notifications';
import { PeoplePage } from './pages/People';
import { ForgotPage, LoginPage, SetPasswordPage } from './pages/Auth';
import { HelpPage } from './pages/Help';
import { CapturePage } from './pages/Capture';
import { DashboardPage } from './pages/Dashboard';
import { ArchivedPage } from './pages/Archived';
import { TablePage } from './pages/Table';

const FS = [12, 13, 14, 15, 16, 18];
const FS_KEY = 'synctasks.fs';

function useFontSize() {
  const [fs, setFs] = useState(() => {
    try {
      const v = Number(localStorage.getItem(FS_KEY) ?? localStorage.getItem('nerus.fs'));
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
  if (route.path === '/capturar') return <CapturePage params={route.params} />;
  return <Shell />;
}

const PAGES: Record<string, { title: string }> = {
  '/painel': { title: 'Painel' },
  '/quadros': { title: 'Tarefas' },
  '/entrada': { title: 'Caixa de entrada' },
  '/arquivadas': { title: 'Arquivadas' },
  '/delegadas': { title: 'Tarefas delegadas' },
  '/avisos': { title: 'Avisos' },
  '/pessoas': { title: 'Pessoas' },
  '/ajuda': { title: 'Ajuda' },
};

type Theme = 'auto' | 'light' | 'dark';
const THEMES: { id: Theme; label: string; icon: IconName }[] = [
  { id: 'auto', label: 'Tema automático (segue o Windows)', icon: 'monitor' },
  { id: 'light', label: 'Tema claro', icon: 'sun' },
  { id: 'dark', label: 'Tema escuro', icon: 'moon' },
];

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = (localStorage.getItem(key) ?? localStorage.getItem(key.replace('synctasks.', 'nerus.'))) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sem armazenamento: só não lembra */ }
}

/** Claro, escuro ou automático (segue o sistema). A escolha fica no navegador. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => stored('synctasks.theme', ['auto', 'light', 'dark'] as const, 'auto'));
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    store('synctasks.theme', theme);
  }, [theme]);
  const i = THEMES.findIndex((t) => t.id === theme);
  return { current: THEMES[i], next: () => setTheme(THEMES[(i + 1) % THEMES.length].id) };
}

function Shell() {
  const route = useRoute();
  const me = useMe().data!;
  const qc = useQueryClient();
  const font = useFontSize();
  const theme = useTheme();
  const [legend, setLegend] = useState(false);
  const [collapsed, setCollapsed] = useState(() => stored('synctasks.side', ['open', 'closed'] as const, 'open') === 'closed');
  const lastPage = useRef('/quadros');

  // Item 36: "Tarefas" em quadro (kanban) ou tabela. A escolha fica lembrada no navegador.
  const [view, setViewState] = useState<'quadro' | 'tabela'>(() => stored('synctasks.visao', ['quadro', 'tabela'] as const, 'quadro'));
  const setView = (v: 'quadro' | 'tabela') => { store('synctasks.visao', v); setViewState(v); };

  const toggleSide = () => setCollapsed((c) => { store('synctasks.side', c ? 'open' : 'closed'); return !c; });

  const hasReports = me.directReports.length > 0;
  const home = !me.user.inHierarchy ? '/pessoas' : hasReports ? '/painel' : '/quadros';
  let page = route.path;
  const cardCode = page.startsWith('/tarefa/') ? decodeURIComponent(page.slice(8)) : null;
  if (cardCode) page = lastPage.current;
  else if (!PAGES[page]) page = home;
  // Guarda também os filtros (?filtro=...) para voltar ao mesmo lugar ao fechar uma tarefa.
  if (!cardCode) lastPage.current = PAGES[route.path] && route.params.toString() ? `${page}?${route.params}` : page;

  useEffect(() => {
    if (!cardCode && !PAGES[route.path]) go(home);
  }, [route.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = `${cardCode ? 'Tarefa' : PAGES[page]?.title ?? ''} · SyncTasks`;
  }, [page, cardCode]);

  const nav: { path: string; label: string; icon: IconName; n?: number; attn?: boolean; show: boolean }[] = [
    { path: '/painel', label: 'Painel', icon: 'chart', show: hasReports },
    { path: '/quadros', label: 'Tarefas', icon: 'board', show: me.user.inHierarchy },
    { path: '/entrada', label: 'Caixa de entrada', icon: 'inbox', n: me.counts.inbox, show: me.user.inHierarchy },
    { path: '/arquivadas', label: 'Arquivadas', icon: 'archive', show: me.user.inHierarchy },
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
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <aside className="side">
        <button className="brand" onClick={toggleSide} title={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!collapsed} aria-label={`SyncTasks: ${collapsed ? 'expandir' : 'recolher'} menu`}><img src="/icon.svg" alt="" /><span>SyncTasks</span></button>
        <div className="who" title={collapsed ? `${me.user.name} · ${me.user.roleTitle}` : undefined}>
          <Avatar name={me.user.name} large /><div style={{ minWidth: 0 }}><b>{me.user.name}</b><small>{me.user.roleTitle}</small></div>
        </div>
        <nav className="nav" aria-label="Principal">
          {nav.filter((n) => n.show).map((n) => (
            <a key={n.path} href={`#${n.path}`} aria-current={page === n.path ? 'page' : undefined} title={collapsed ? n.label : undefined}>
              <span className="ico"><Icon name={n.icon} /></span>
              <span>{n.label}</span>
              {!!n.n && <span className={`n${n.attn ? ' attn' : ''}`}>{n.n}</span>}
            </a>
          ))}
        </nav>
        <div className="foot">
          <button onClick={() => go('/ajuda')} title="Ajuda e manual" aria-current={page === '/ajuda' ? 'page' : undefined}>
            <span className="ico"><Icon name="book" /></span><span className="lbl">Ajuda</span>
          </button>
          <button onClick={() => setLegend(true)} title="Legenda dos ícones"><span className="ico"><Icon name="help" /></span><span className="lbl">Legenda</span></button>
          <button className="collapse" onClick={toggleSide} title={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!collapsed}>
            <span className="ico"><Icon name={collapsed ? 'sideOpen' : 'sideClose'} /></span><span className="lbl">Recolher menu</span>
          </button>
          <button onClick={logout} title="Sair"><span className="ico"><Icon name="logout" /></span><span className="lbl">Sair</span></button>
        </div>
      </aside>
      <main className={me.prefs.workspaceBg ? `ws ws-${me.prefs.workspaceBg}` : undefined}>
        <div className="topbar">
          <h1>{PAGES[page]?.title}</h1>
          <div className="tools">
            {page === '/quadros' && (
              <span className="view-switch" role="group" aria-label="Ver as tarefas em">
                <button aria-pressed={view === 'quadro'} onClick={() => setView('quadro')} title="Quadros (kanban)" aria-label="Ver em quadros"><Icon name="board" />Quadro</button>
                <button aria-pressed={view === 'tabela'} onClick={() => setView('tabela')} title="Todas as tarefas numa tabela, com filtros" aria-label="Ver em tabela"><Icon name="table" />Tabela</button>
              </span>
            )}
            {me.user.inHierarchy && <SearchBox />}
            <span className="seg" role="group" aria-label="Tamanho do texto">
              <button onClick={font.down} disabled={!font.down} aria-label="Diminuir texto" title="Diminuir texto">A−</button>
              <button onClick={font.up} disabled={!font.up} aria-label="Aumentar texto" title="Aumentar texto">A+</button>
            </span>
            <button className="b icon" onClick={theme.next} title={`${theme.current.label}. Clique para trocar.`} aria-label={`${theme.current.label}. Clique para trocar.`}>
              <Icon name={theme.current.icon} />
            </button>
          </div>
        </div>
        {page === '/painel' && <DashboardPage />}
        {page === '/quadros' && (view === 'tabela' ? <TablePage /> : <BoardsPage />)}
        {page === '/arquivadas' && <ArchivedPage />}
        {page === '/entrada' && <InboxPage />}
        {page === '/delegadas' && <DelegatedPage />}
        {page === '/avisos' && <NotificationsPage />}
        {page === '/pessoas' && <PeoplePage />}
        {page === '/ajuda' && <HelpPage isAdmin={me.user.isAdmin} />}
      </main>
      {cardCode && <CardModal key={cardCode} code={cardCode} onClose={() => go(lastPage.current)} />}
      {legend && <LegendDialog onClose={() => setLegend(false)} />}
    </div>
  );
}

function SearchBox() {
  const me = useMe().data;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const res = useQuery({
    queryKey: ['search', term],
    queryFn: () => {
      // Item 37: um número (12 ou #12) abre a tarefa 12 do quadro aberto; se não houver lá, mostra as de outros quadros.
      const board = rememberedBoard();
      return get<{ byCode: (Card & { role: string }) | null; results: Card[] }>(`/search?q=${encodeURIComponent(term)}${board ? `&board=${board}` : ''}`);
    },
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
  const pick = (id: string) => { setOpen(false); setQ(''); go(`/tarefa/${id}`); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = res.data;
    const first = d?.byCode ?? d?.results[0];
    if (first) pick(first.id);
  };
  const items = res.data ? (res.data.byCode ? [res.data.byCode] : res.data.results) : [];
  return (
    <div className="search" ref={ref}>
      <form onSubmit={submit} role="search">
        <input className="input" type="search" placeholder="Buscar tarefa ou número" aria-label="Buscar tarefa ou número" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
      </form>
      {open && term && (
        <div className="search-pop">
          {res.isLoading && <p className="hint">Buscando…</p>}
          {res.data && items.length === 0 && <p className="hint">Nada encontrado entre as tarefas que você pode ver.</p>}
          {items.map((c) => (
            <button key={c.id} onClick={() => pick(c.id)}>
              <CardStatusIcon card={c} />
              <span className="t">{c.title}</span>
              <span className="code">{c.ownerId === me?.user.id ? `${cardNo(c.num)} · ${c.boardName ?? (c.inInbox ? 'Caixa de entrada' : 'fora dos quadros')}` : c.ownerName}</span>
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
