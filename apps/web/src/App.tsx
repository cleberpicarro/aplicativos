import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post, setActingAs, type Card } from './lib/api';
import { go, useRoute } from './lib/router';
import { STATUS, cardNo, type StatusKey } from './lib/format';
import { Avatar, CardStatusIcon, Dialog, ErrorText, StatusIcon, TipIcon, useMe } from './components/ui';
import { Icon, type IconName } from './components/Icons';
import { CardModal } from './components/CardModal';
import { SubstitutionBox } from './components/Substitution';
import { useAction } from './components/dialogs';
import { BoardsPage, rememberedBoard } from './pages/Boards';
import { InboxPage } from './pages/Inbox';
import { DelegatedPage } from './pages/Delegated';
import { NotificationsPage } from './pages/Notifications';
import { PeoplePage } from './pages/People';
import { ConnectPage, ForgotPage, LoginPage, SetPasswordPage } from './pages/Auth';
import { HelpPage } from './pages/Help';
import { CapturePage } from './pages/Capture';
import { DashboardPage } from './pages/Dashboard';
import { ArchivedPage } from './pages/Archived';
import { TablePage } from './pages/Table';
import { SHORTCUTS, isTyping, requestNewTask } from './lib/shortcuts';

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
  if (route.path === '/conectar') return <ConnectPage params={route.params} />;
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
  const font = useFontSize();
  const theme = useTheme();
  const [legend, setLegend] = useState(false);
  const [myData, setMyData] = useState(false);
  const [keysHelp, setKeysHelp] = useState(false);
  const [collapsed, setCollapsed] = useState(() => stored('synctasks.side', ['open', 'closed'] as const, 'open') === 'closed');
  const lastPage = useRef('/quadros');

  // Item 36: "Tarefas" em quadro (kanban) ou tabela. A escolha fica lembrada no navegador.
  // Item 59: no Quadro, o filtro sobe para a barra do topo (no celular continua acima das fases).
  // Item 64: na Tabela também, no mesmo lugar, para o botão Quadro/Tabela não mudar de posição.
  const [filterSlot, setFilterSlot] = useState<HTMLElement | null>(null);
  const wide = useWide();
  const [view, setViewState] = useState<'quadro' | 'tabela'>(() => stored('synctasks.visao', ['quadro', 'tabela'] as const, 'quadro'));
  const setView = (v: 'quadro' | 'tabela') => { store('synctasks.visao', v); setViewState(v); };

  const toggleSide = () => setCollapsed((c) => { store('synctasks.side', c ? 'open' : 'closed'); return !c; });

  // Item 68: no celular o menu fica atrás do botão ☰ e abre como um painel pela esquerda.
  // Abrir cria um passo no histórico, para o botão Voltar do celular fechar o menu sem sair da tela.
  const [menu, setMenu] = useState(false);
  const openMenu = () => { history.pushState({ synctasksMenu: true }, ''); setMenu(true); };
  const closeMenu = (then?: () => void) => {
    setMenu(false);
    if (!(history.state as { synctasksMenu?: boolean } | null)?.synctasksMenu) { then?.(); return; }
    if (then) window.addEventListener('popstate', () => then(), { once: true });
    history.back();
  };
  useEffect(() => {
    if (!menu) return;
    const onPop = () => setMenu(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    document.querySelector<HTMLElement>('.drawer .x')?.focus();
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  // Virou tela larga (celular deitado, janela maior): o menu volta a ser a barra lateral.
  useEffect(() => { if (wide && menu) closeMenu(); }, [wide]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasReports = me.directReports.length > 0;
  // Item 72: agindo como a pessoa substituída (seletor do topo). Dados pessoais, avisos e administração ficam de fora.
  const acting = me.substitution.acting;
  // Item 58: todo mundo da hierarquia abre nas próprias tarefas (o Painel fica a um clique, no menu).
  const home = !me.user.inHierarchy ? '/pessoas' : '/quadros';
  let page = route.path;
  const cardCode = page.startsWith('/tarefa/') ? decodeURIComponent(page.slice(8)) : null;
  if (cardCode) page = lastPage.current;
  else if (!PAGES[page] || (acting && (page === '/avisos' || page === '/pessoas'))) page = home;
  // Guarda também os filtros (?filtro=...) para voltar ao mesmo lugar ao fechar uma tarefa.
  if (!cardCode) lastPage.current = PAGES[route.path] && route.params.toString() ? `${page}?${route.params}` : page;

  useEffect(() => {
    if (!cardCode && !PAGES[route.path]) go(home);
  }, [route.path]); // eslint-disable-line react-hooks/exhaustive-deps
  // Item 56: atalhos de teclado gerais (N, / e ?). Não valem com uma janela aberta nem enquanto a pessoa escreve.
  const keyState = useRef({ page, view });
  keyState.current = { page, view };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector('.scrim')) return;
      if (e.key === '?') { e.preventDefault(); setKeysHelp(true); return; }
      if (e.key === '/') {
        const box = document.querySelector<HTMLInputElement>('.search input');
        if (box) { e.preventDefault(); box.focus(); }
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && me.user.inHierarchy) {
        e.preventDefault();
        if (keyState.current.view !== 'quadro') setView('quadro');
        if (keyState.current.page !== '/quadros') go('/quadros');
        requestNewTask();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = `${cardCode ? 'Tarefa' : PAGES[page]?.title ?? ''} · SyncTasks`;
  }, [page, cardCode]);

  const nav: { path: string; label: string; icon: IconName; n?: number; attn?: boolean; show: boolean }[] = [
    { path: '/painel', label: 'Painel', icon: 'chart', show: hasReports },
    { path: '/quadros', label: 'Tarefas', icon: 'board', show: me.user.inHierarchy },
    { path: '/entrada', label: 'Caixa de entrada', icon: 'inbox', n: me.counts.inbox, show: me.user.inHierarchy },
    { path: '/arquivadas', label: 'Arquivadas', icon: 'archive', show: me.user.inHierarchy },
    { path: '/delegadas', label: 'Tarefas delegadas', icon: 'users', n: me.counts.needAction, attn: true, show: hasReports },
    { path: '/avisos', label: 'Avisos', icon: 'bell', n: me.counts.unread, show: !acting },
    { path: '/pessoas', label: 'Pessoas', icon: 'shield', show: me.user.isAdmin && !acting },
  ];

  // O número no ☰ soma os contadores do menu (caixa de entrada, delegadas que pedem ação, avisos não lidos).
  const waiting = nav.filter((n) => n.show).reduce((sum, n) => sum + (n.n ?? 0), 0);

  const logout = async () => {
    await post('/auth/logout');
    // Recarregar já apaga os dados da memória. Limpar o cache antes fazia as telas abertas desenharem
    // sem a pessoa por um instante (erro na página ao sair com o menu do celular aberto, item 68).
    go('/entrar');
    window.location.reload();
  };

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${menu ? ' menu-open' : ''}`}>
      <aside className="side">
        <button className="hb" onClick={openMenu} aria-label={waiting ? `Abrir menu (${waiting} esperando por você)` : 'Abrir menu'} aria-expanded={menu} aria-controls="menu">
          <Icon name="menu" />{!!waiting && <span className="dot">{waiting > 99 ? '99+' : waiting}</span>}
        </button>
        <button className="brand" onClick={toggleSide} title={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!collapsed} aria-label={`SyncTasks: ${collapsed ? 'expandir' : 'recolher'} menu`}><img src="/icon.svg" alt="" /><span>SyncTasks</span></button>
        {menu && <div className="menu-scrim" onClick={() => closeMenu()} />}
        <div className="drawer" id="menu">
          <div className="dh">
            <span className="brand"><img src="/icon.svg" alt="" /><span>SyncTasks</span></span>
            <button className="x" onClick={() => closeMenu()} aria-label="Fechar menu" title="Fechar menu"><Icon name="x" /></button>
          </div>
          {acting ? (
            <div className="who acting-who" title={`Substituindo ${acting.name}`}>
              <Avatar name={acting.name} large /><div style={{ minWidth: 0 }}><b>{acting.name}</b><small>Substituído(a) por você</small></div>
            </div>
          ) : (
            <button className="who" onClick={() => closeMenu(() => setMyData(true))} title={collapsed ? `${me.user.name} · ${me.user.roleTitle}. Meus dados` : 'Meus dados'}>
              <Avatar name={me.user.name} large /><div style={{ minWidth: 0 }}><b>{me.user.name}</b><small>{me.user.roleTitle}</small></div>
            </button>
          )}
          <nav className="nav" aria-label="Principal">
            {nav.filter((n) => n.show).map((n) => (
              <a key={n.path} href={`#${n.path}`} aria-current={page === n.path ? 'page' : undefined} title={collapsed ? n.label : undefined}
                onClick={menu ? (e) => { e.preventDefault(); setMenu(false); window.location.replace(`#${n.path}`); } : undefined}>
                <span className="ico"><Icon name={n.icon} /></span>
                <span>{n.label}</span>
                {!!n.n && <span className={`n${n.attn ? ' attn' : ''}`}>{n.n}</span>}
              </a>
            ))}
          </nav>
          <div className="foot">
            <button onClick={() => closeMenu(() => go('/ajuda'))} title="Ajuda e manual" aria-current={page === '/ajuda' ? 'page' : undefined}>
              <span className="ico"><Icon name="book" /></span><span className="lbl">Ajuda</span>
            </button>
            <button onClick={() => closeMenu(() => setLegend(true))} title="Legenda dos ícones"><span className="ico"><Icon name="help" /></span><span className="lbl">Legenda</span></button>
            <button className="keys-btn" onClick={() => setKeysHelp(true)} title="Atalhos de teclado (tecla ?)"><span className="ico"><Icon name="keyboard" /></span><span className="lbl">Atalhos</span></button>
            {!acting && <button className="my-data" onClick={() => closeMenu(() => setMyData(true))} title="Meus dados"><span className="ico"><Icon name="self" /></span><span className="lbl">Meus dados</span></button>}
            <button className="collapse" onClick={toggleSide} title={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!collapsed}>
              <span className="ico"><Icon name={collapsed ? 'sideOpen' : 'sideClose'} /></span><span className="lbl">Recolher menu</span>
            </button>
            <button onClick={logout} title="Sair"><span className="ico"><Icon name="logout" /></span><span className="lbl">Sair</span></button>
          </div>
        </div>
      </aside>
      <main className={me.prefs.workspaceBg ? `ws ws-${me.prefs.workspaceBg}` : undefined}>
        <div className="topbar">
          <h1>{PAGES[page]?.title}</h1>
          <div className="tools">
            {(acting || me.substitution.covering.length > 0) && <ActingPicker />}
            {page === '/quadros' && wide && <span className="filter-slot" ref={setFilterSlot} />}
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
        {acting && <ActingBar />}
        {page === '/painel' && <DashboardPage />}
        {page === '/quadros' && (view === 'tabela' ? <TablePage top={wide ? filterSlot : null} /> : <BoardsPage top={wide ? filterSlot : null} />)}
        {page === '/arquivadas' && <ArchivedPage />}
        {page === '/entrada' && <InboxPage />}
        {page === '/delegadas' && <DelegatedPage />}
        {page === '/avisos' && <NotificationsPage />}
        {page === '/pessoas' && <PeoplePage />}
        {page === '/ajuda' && <HelpPage isAdmin={me.user.isAdmin} />}
      </main>
      {cardCode && <CardModal key={cardCode} code={cardCode} onClose={() => go(lastPage.current)} />}
      {legend && <LegendDialog onClose={() => setLegend(false)} />}
      {myData && <MyDataDialog onClose={() => setMyData(false)} />}
      {keysHelp && <ShortcutsDialog onClose={() => setKeysHelp(false)} />}
      <ArrivalBalloon />
    </div>
  );
}

/**
 * Item 80: balão no canto quando chega tarefa delegada ou transferida. Clicar abre a tarefa (várias juntas: a caixa
 * de entrada) e marca o aviso como lido; some sozinho em 10 segundos, e o aviso continua no sino.
 */
function ArrivalBalloon() {
  const me = useMe().data;
  const qc = useQueryClient();
  const [shown, setShown] = useState<{ ids: string[]; text: string; cardId: string | null } | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = (me?.fresh ?? []).filter((n) => !seen.current.has(n.id));
    if (!fresh.length) return;
    for (const n of fresh) seen.current.add(n.id);
    const ids = fresh.map((n) => n.id);
    setShown(fresh.length === 1
      ? { ids, text: fresh[0].text, cardId: fresh[0].cardId }
      : { ids, text: `${fresh.length} tarefas novas chegaram para você`, cardId: null });
    post('/notifications/popped', { ids }).catch(() => { /* sem rede: o balão pode aparecer de novo depois */ });
  }, [me?.fresh]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 10_000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  const open = () => {
    post('/notifications/popped', { ids: shown.ids, read: true }).then(() => qc.invalidateQueries({ queryKey: ['me'] })).catch(() => {});
    go(shown.cardId ? `/tarefa/${shown.cardId}` : '/entrada');
    setShown(null);
  };
  return (
    <div className="arrival" role="status">
      <button className="arrival-open" onClick={open}>
        <Icon name="inbox" />
        <span><b>{shown.text}</b><small>Clique para ver</small></span>
      </button>
      <button className="arrival-x" aria-label="Fechar o aviso" onClick={() => setShown(null)}><Icon name="x" /></button>
    </div>
  );
}

/** Item 72: “De quem são as tarefas na tela”: as próprias ou as de quem a pessoa está substituindo. */
function ActingPicker() {
  const me = useMe().data!;
  const { covering, acting } = me.substitution;
  return (
    <label className={`acting-pick${acting ? ' on' : ''}`} title="Trocar entre as suas tarefas e as de quem você está substituindo">
      <Icon name="users" />
      <select value={acting?.id ?? ''} onChange={(e) => setActingAs(e.target.value || null)} aria-label="Tarefas de quem">
        <option value="">Minhas tarefas</option>
        {covering.map((c) => <option key={c.id} value={c.id}>Substituindo {c.name}</option>)}
      </select>
    </label>
  );
}

/** Item 72: faixa que lembra, em todas as telas, que se está agindo por outra pessoa. */
function ActingBar() {
  const acting = useMe().data!.substitution.acting!;
  return (
    <div className="acting-bar" role="status">
      <Icon name="users" />
      <span>
        Você está substituindo <b>{acting.name}</b>. {acting.shareCommon
          ? 'Aparecem as tarefas comuns e as delegações; as privadas não aparecem.'
          : 'Aparecem só as delegações, o que chegou de outras pessoas e o que você criar; as tarefas comuns e as privadas não aparecem.'}
      </span>
      <button className="b sm" onClick={() => setActingAs(null)}>Voltar para as minhas tarefas</button>
    </div>
  );
}

/** Tela larga (computador e notebook); no celular, até 820 px, como no styles.css. */
function useWide() {
  const query = '(min-width: 821px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const change = () => setWide(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  return wide;
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

/** Item 46: Meus dados, com as escolhas de e-mail da própria pessoa. */
function MyDataDialog({ onClose }: { onClose: () => void }) {
  const me = useMe().data!;
  const { run, error } = useAction();
  const set = (prefs: { emailDigest?: boolean; emailDue?: boolean }, msg: string) => run(() => patch('/me/prefs', prefs), msg);
  return (
    <Dialog title="Meus dados" onClose={onClose} footer={<button className="b pri" onClick={onClose}>Pronto</button>}>
      <dl className="my-data-list">
        <dt>Nome</dt><dd>{me.user.name}</dd>
        <dt>E-mail</dt><dd>{me.user.email}</dd>
        <dt>Cargo</dt><dd>{me.user.roleTitle}</dd>
      </dl>
      <p className="hint" style={{ margin: 0 }}>Para mudar nome, e-mail ou cargo, fale com a administração.</p>
      {me.user.inHierarchy && (
        <fieldset className="my-mail">
          <legend>E-mails do SyncTasks</legend>
          <label className="check">
            <input type="checkbox" checked={me.prefs.emailDigest}
              onChange={(e) => set({ emailDigest: e.target.checked }, e.target.checked ? 'Resumo diário ligado.' : 'Resumo diário desligado.')} />
            <span>Receber resumo diário por e-mail<small>Às 7h, de segunda a sexta, só quando houver algo: o que vence hoje, o que está atrasado, o que espera o seu aceite e o seu ciente.</small></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={me.prefs.emailDue}
              onChange={(e) => set({ emailDue: e.target.checked }, e.target.checked ? 'Avisos de prazo ligados.' : 'Avisos de prazo desligados.')} />
            <span>Receber avisos de prazo por e-mail<small>Um e-mail na véspera do prazo e outro no dia seguinte, se a tarefa continuar aberta.</small></span>
          </label>
          <p className="hint" style={{ margin: 0 }}>Os avisos de delegação (delegar, aceitar, devolver, concluir, ciente…) continuam chegando sempre.</p>
        </fieldset>
      )}
      {me.user.inHierarchy && <SubstitutionBox />}
      {me.user.inHierarchy && <AssistantsBox />}
      <ErrorText error={error} />
    </Dialog>
  );
}

interface Assistant { id: string; name: string; host: string; createdAt: string; lastUsedAt: string | null }
const brDay = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** Item 65: como ligar o Claude (ou outro assistente compatível) e quais estão ligados, com Desligar. */
function AssistantsBox() {
  const q = useQuery({ queryKey: ['assistants'], queryFn: () => get<Assistant[]>('/me/assistants') });
  const qc = useQueryClient();
  const { run } = useAction();
  const [copied, setCopied] = useState(false);
  const address = `${window.location.origin}/mcp`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* sem área de transferência: o endereço continua à vista para copiar à mão */ }
  };
  const off = (a: Assistant) =>
    run(async () => {
      await del(`/me/assistants/${a.id}`);
      await qc.invalidateQueries({ queryKey: ['assistants'] });
    }, `${a.name} desligado.`);
  return (
    <fieldset className="my-mail my-ai">
      <legend>Assistente de IA (Claude)</legend>
      <p className="hint" style={{ margin: 0 }}>
        Para o Claude criar e consultar as suas tarefas: no Claude, abra <b>Configurações › Conectores › Adicionar conector personalizado</b>, cole o endereço abaixo e clique em <b>Permitir</b> quando o SyncTasks perguntar.
      </p>
      <div className="copy-line">
        <code>{address}</code>
        <button type="button" className="b" onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
      </div>
      {q.data && (q.data.length ? (
        <ul className="ai-list">
          {q.data.map((a) => (
            <li key={a.id}>
              <span><b>{a.name}</b> <span className="hint">({a.host})</span><small>Ligado em {brDay(a.createdAt)}{a.lastUsedAt ? ` · usado por último em ${brDay(a.lastUsedAt)}` : ''}</small></span>
              <button type="button" className="b" onClick={() => off(a)}>Desligar</button>
            </li>
          ))}
        </ul>
      ) : <p className="hint" style={{ margin: 0 }}>Nenhum assistente ligado à sua conta.</p>)}
    </fieldset>
  );
}

/** Item 56: a lista de atalhos de teclado (tecla ? ou “Atalhos” no menu). */
function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Atalhos de teclado" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>Funcionam quando você não está escrevendo num campo.</p>
      <dl className="keys-list">
        {SHORTCUTS.map((s) => (
          <div key={s.what}>
            <dt>{s.keys.map((k, i) => <span key={k}>{i > 0 && ' + '}<kbd>{k}</kbd></span>)}</dt>
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function LegendDialog({ onClose }: { onClose: () => void }) {
  const keys: StatusKey[] = ['active', 'inbox', 'awaiting', 'declined', 'reopened', 'acked', 'canceled', 'done'];
  return (
    <Dialog title="Legenda" onClose={onClose}>
      <p className="hint">Passe o mouse ou toque em qualquer ícone para ver o significado.</p>
      <div className="legend">
        {keys.map((k) => <div key={k}><StatusIcon status={k} />{STATUS[k].label}</div>)}
        <div><span className="dtag from"><Icon name="into" />De Ana</span>Delegada para você por alguém acima (Ana)</div>
        <div><span className="dtag to"><Icon name="out" />Para João</span>Você delegou para um subordinado (João)</div>
        <div><TipIcon name="lock" tip="Privada" />Privada: nenhum superior vê</div>
        <div><span className="due late">3 out</span>Prazo atrasado</div>
        <div><span className="due today">hoje</span>Vence hoje</div>
        <div><span className="pill attn">âmbar</span>Precisa da sua ação</div>
      </div>
    </Dialog>
  );
}
