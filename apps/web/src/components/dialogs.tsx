import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type Card } from '../lib/api';
import { cardNo, firstName } from '../lib/format';
import { go } from '../lib/router';
import { Dialog, ErrorText, useMe, useToast } from './ui';

/** Item 54: o que não precisa ser baixado de novo quando só uma tarefa mudou. */
const CARD_SCOPE_SKIP = new Set(['boards', 'table-options', 'filters']);
const isCardQuery = (key: readonly unknown[]) => key[0] === 'board' || key[0] === 'card';

/**
 * Executa uma ação, mostra o resultado e recarrega os dados da tela.
 * Item 54: com `optimistic`, a mudança aparece na tela antes da resposta do servidor (e volta se ele recusar);
 * a recarga então corre por trás, sem segurar a tela. `scope: 'card'` recarrega só o que depende da tarefa.
 */
export function useAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(fn: () => Promise<T>, success?: string, opts?: { optimistic?: () => () => void; scope?: 'card' }): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    let undo: (() => void) | undefined;
    if (opts?.optimistic) {
      // Uma recarga já em andamento traria os dados de antes da mudança por cima dela.
      await qc.cancelQueries({ predicate: (q) => isCardQuery(q.queryKey) });
      undo = opts.optimistic();
    }
    try {
      const r = await fn();
      const reload = qc.invalidateQueries(opts?.scope === 'card' ? { predicate: (q) => !CARD_SCOPE_SKIP.has(String(q.queryKey[0])) } : undefined);
      if (!opts?.optimistic) await reload;
      if (success) toast(success);
      return r;
    } catch (err) {
      undo?.();
      setError(err);
      if (undo) toast((err as Error).message, 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}

/**
 * Item 48: aviso "Delegação cancelada" com o botão Desfazer. Desfazer devolve a tarefa à pessoa, no mesmo quadro,
 * fase e número, e ela é avisada. Funciona logo depois de cancelar.
 */
export function useCancelDelegation() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (delegationId: string, ownerName: string, declined = false) => {
    await post(`/delegations/${delegationId}/cancel`);
    // Item 75: a devolvida cancelada leva junto a tarefa de origem para Arquivadas.
    toast(declined ? 'Delegação cancelada. A tarefa foi para Arquivadas.' : `Delegação cancelada. ${firstName(ownerName)} foi avisado(a).`, 'ok', {
      label: 'Desfazer',
      onClick: () => post(`/delegations/${delegationId}/undo-cancel`).then(
        async () => { await qc.invalidateQueries(); toast(declined ? 'Cancelamento desfeito: a tarefa voltou para o seu quadro.' : `Cancelamento desfeito: a tarefa voltou para ${firstName(ownerName)}.`); },
        (e) => toast((e as Error).message, 'error'),
      ),
    });
    return true;
  };
}

/**
 * Item 75: "Retomar" uma tarefa devolvida. A delegação é encerrada e a tarefa de origem volta para a caixa de entrada
 * de quem delegou (ou continua no quadro, se ela mesma veio de cima por delegação). O aviso traz "Abrir".
 */
export function useResume() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (delegationId: string) => {
    let r: { cardId: string; inbox: boolean };
    try {
      r = await post<{ cardId: string; inbox: boolean }>(`/delegations/${delegationId}/resume`);
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
    await qc.invalidateQueries();
    toast(r.inbox ? 'Tarefa retomada: ela está na sua caixa de entrada.' : 'Tarefa retomada: ela continua no seu quadro.', 'ok', {
      label: 'Abrir',
      onClick: () => go(`/tarefa/${r.cardId}`),
    });
    return true;
  };
}

/**
 * Item 50: descarta tarefas da caixa de entrada (vão para Arquivadas, sem concluir), com Desfazer no aviso.
 * Devolve false se o servidor recusou; o erro aparece no aviso.
 */
export function useDiscard() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (ids: string[]) => {
    try {
      await post('/inbox/discard', { ids });
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
    await qc.invalidateQueries();
    toast(ids.length === 1 ? 'Tarefa descartada.' : `${ids.length} tarefas descartadas.`, 'ok', {
      label: 'Desfazer',
      onClick: () => post('/inbox/restore', { ids }).then(
        async () => { await qc.invalidateQueries(); toast(ids.length === 1 ? 'A tarefa voltou para a caixa de entrada.' : `${ids.length} tarefas voltaram para a caixa de entrada.`); },
        (e) => toast((e as Error).message, 'error'),
      ),
    });
    return true;
  };
}

/**
 * Item 82: descarta, de dentro da tarefa, uma tarefa própria e aberta do quadro (vai para Arquivadas sem concluir).
 * O Desfazer do aviso desarquiva: ela volta à mesma fase e posição, com o mesmo número.
 */
export function useDiscardCard() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (id: string) => {
    try {
      await post(`/cards/${id}/discard`);
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
    await qc.invalidateQueries();
    toast('Tarefa descartada.', 'ok', {
      label: 'Desfazer',
      onClick: () => post(`/cards/${id}/unarchive`).then(
        async () => { await qc.invalidateQueries(); toast('A tarefa voltou para o quadro.'); },
        (e) => toast((e as Error).message, 'error'),
      ),
    });
    return true;
  };
}

type Close = () => void;

function Footer({ busy, onClose, label, danger }: { busy: boolean; onClose: Close; label: string; danger?: boolean }) {
  return (
    <>
      <button type="button" className="b" onClick={onClose}>Cancelar</button>
      <button type="submit" form="dlg" className={`b ${danger ? 'danger' : 'pri'}`} disabled={busy}>{busy ? 'Aguarde…' : label}</button>
    </>
  );
}

/** Escolha de quadro e fase (Aceitar e organizar, e Delegar direto da caixa de entrada). */
function useBoardList() {
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => get<{ id: string; name: string }[]>('/boards') });
  const [boardId, setBoardId] = useState('');
  const bId = boardId || boards.data?.[0]?.id || '';
  const board = useQuery({ queryKey: ['board', bId], queryFn: () => get(`/boards/${bId}`), enabled: !!bId });
  const [listId, setListId] = useState('');
  const lists: { id: string; name: string }[] = board.data?.lists ?? [];
  const lId = lists.some((l) => l.id === listId) ? listId : lists[0]?.id ?? '';
  const listName = lists.find((l) => l.id === lId)?.name;
  const boardName = boards.data?.find((b) => b.id === bId)?.name;
  const fields = (
    <div className="row2">
      <div className="field">
        <label htmlFor="a-b">Quadro</label>
        <select id="a-b" className="select input" value={bId} onChange={(e) => { setBoardId(e.target.value); setListId(''); }}>
          {boards.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="a-l">Fase</label>
        <select id="a-l" className="select input" value={lId} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
    </div>
  );
  return { lId, listName, boardName, fields };
}

/** Item 50: com fromInbox, a janela também pede o quadro e a fase onde fica a sua tarefa, e aceita e delega de uma vez. */
export function DelegateDialog({ card, onClose, fromInbox }: { card: Card; onClose: Close; fromInbox?: boolean }) {
  const me = useMe().data!;
  const { run, busy, error } = useAction();
  const place = useBoardList();
  const [to, setTo] = useState(me.directReports[0]?.id ?? '');
  const [due, setDue] = useState(card.dueDate ?? '');
  const [note, setNote] = useState('');
  const [noPass, setNoPass] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = me.directReports.find((r) => r.id === to)?.name ?? '';
    const body = { toUserId: to, suggestedDue: due || null, note, noPass };
    const r = fromInbox
      ? await run(() => post(`/cards/${card.id}/accept-delegate`, { ...body, listId: place.lId }), `Tarefa colocada em “${place.listName}” e delegada para ${firstName(name)}.`)
      : await run(() => post(`/cards/${card.id}/delegate`, body), `Delegada para ${firstName(name)}. Aviso enviado por e-mail.`);
    if (r) onClose();
  };
  return (
    <Dialog title="Delegar tarefa" onClose={onClose} footer={<Footer busy={busy || (!!fromInbox && !place.lId)} onClose={onClose} label="Delegar" />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <div className="box"><span className="code">{cardNo(card.num)}</span> <b style={{ fontWeight: 500 }}>{card.title}</b></div>
        <p className="hint">A pessoa recebe um cartão ligado a este, com o número do quadro dela. Você acompanha até dar o ciente.</p>
        {fromInbox && (
          <>
            <p className="hint" style={{ margin: 0 }}>Onde fica a sua tarefa, para acompanhar:</p>
            {place.fields}
          </>
        )}
        <div className="field">
          <label htmlFor="d-to">Para (subordinado direto)</label>
          <select id="d-to" className="select input" value={to} onChange={(e) => setTo(e.target.value)} required>
            {me.directReports.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.roleTitle}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-due">Prazo sugerido</label>
          <input id="d-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          <span className="hint">Quem recebe pode ajustar. Você é avisado por e-mail se mudar.</span>
        </div>
        <div className="field">
          <label htmlFor="d-note">Observação (opcional)</label>
          <textarea id="d-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contexto ou instruções para quem vai executar" />
        </div>
        <NoPassField value={noPass} onChange={setNoPass} />
        {card.isPrivate && <p className="box attn" style={{ margin: 0 }}>Esta tarefa é privada; ao delegar, ela deixa de ser privada.</p>}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

/** Item 41: caixinha da janela Delegar e Redelegar. */
function NoPassField({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>Não pode ser repassada <span className="hint">(a pessoa precisa fazer: não pode delegar nem transferir para um subordinado)</span></span>
    </label>
  );
}

export function RedelegateDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const me = useMe().data!;
  const { run, busy, error } = useAction();
  const [to, setTo] = useState(me.directReports.find((r) => r.id !== card.ownerId)?.id ?? me.directReports[0]?.id ?? '');
  const [due, setDue] = useState(card.dueDate ?? '');
  const [noPass, setNoPass] = useState(card.delegation?.noPass ?? false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => post(`/delegations/${card.delegation!.id}/redelegate`, { toUserId: to, suggestedDue: due || null, noPass }), 'Tarefa redelegada.')) onClose();
  };
  return (
    <Dialog title="Redelegar tarefa" onClose={onClose} footer={<Footer busy={busy} onClose={onClose} label="Redelegar" />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <div className="box attn">
          <b style={{ fontWeight: 500 }}>{firstName(card.ownerName)} devolveu:</b> “{card.delegation?.declineReason}”
        </div>
        <div className="field">
          <label htmlFor="r-to">Para</label>
          <select id="r-to" className="select input" value={to} onChange={(e) => setTo(e.target.value)}>
            {me.directReports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-due">Prazo sugerido</label>
          <input id="r-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <NoPassField value={noPass} onChange={setNoPass} />
        <p className="hint">É o mesmo cartão: a nova pessoa o recebe na caixa de entrada, com o número de lá.</p>
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

export function DeclineDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const { run, busy, error } = useAction();
  const [reason, setReason] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => post(`/cards/${card.id}/decline`, { reason }), `Tarefa devolvida a ${firstName(card.delegation!.delegatorName)}.`)) onClose();
  };
  return (
    <Dialog title="Devolver tarefa" onClose={onClose} footer={<Footer busy={busy} onClose={onClose} label="Devolver" danger />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}><span className="code">{cardNo(card.num)}</span> {card.title}</p>
        <p className="hint">A tarefa volta para {firstName(card.delegation!.delegatorName)}, que decide se redelega ou cancela.</p>
        <div className="field">
          <label htmlFor="x-reason">Justificativa (obrigatória)</label>
          <textarea id="x-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3}
            placeholder="Por exemplo: prazo inviável, falta informação, não é da minha área" />
        </div>
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

export function ReopenDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const { run, busy, error } = useAction();
  const [comment, setComment] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => post(`/delegations/${card.delegation!.id}/reopen`, { comment }), `Tarefa reaberta e devolvida a ${firstName(card.ownerName)}.`)) onClose();
  };
  return (
    <Dialog title="Reabrir tarefa" onClose={onClose} footer={<Footer busy={busy} onClose={onClose} label="Reabrir e devolver" />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}><span className="code">{cardNo(card.num)}</span> {card.title}</p>
        <div className="field">
          <label htmlFor="ro-c">O que precisa ser refeito? (vai como comentário para {firstName(card.ownerName)})</label>
          <textarea id="ro-c" className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} required minLength={3} />
        </div>
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

export function TransferDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const { run, busy, error } = useAction();
  const targets = useQuery({ queryKey: ['targets', card.id], queryFn: () => get<{ id: string; name: string; role_title: string; relation: string }[]>(`/cards/${card.id}/transfer-targets`) });
  const [to, setTo] = useState('');
  const rel: Record<string, string> = { subordinate: 'subordinado', peer: 'colega do mesmo nível', manager: 'superior direto' };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const chosen = to || targets.data?.[0]?.id;
    if (!chosen) return;
    const msg = card.delegation
      ? `Transferida. ${firstName(card.delegation.delegatorName)} continua acompanhando.`
      : 'Transferida. Você deixa de acompanhar esta tarefa.';
    if (await run(() => post(`/cards/${card.id}/transfer`, { toUserId: chosen }), msg)) onClose();
  };
  return (
    <Dialog title="Transferir tarefa" onClose={onClose} footer={<Footer busy={busy || !targets.data?.length} onClose={onClose} label="Transferir" />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}><span className="code">{cardNo(card.num)}</span> {card.title}</p>
        <p className="hint">
          {card.delegation
            ? `Esta tarefa foi delegada por ${card.delegation.delegatorName}, que continua acompanhando e verá “delegada para …”.`
            : 'Ao transferir, você deixa de acompanhar a tarefa.'}
          {card.delegation?.noPass && ' Esta tarefa não pode ser repassada: os subordinados não aparecem na lista.'}
        </p>
        {targets.data && targets.data.length === 0 && <p className="err">Não há para quem transferir.</p>}
        {targets.data && targets.data.length > 0 && (
          <div className="field">
            <label htmlFor="t-to">Para</label>
            <select id="t-to" className="select input" value={to || targets.data[0].id} onChange={(e) => setTo(e.target.value)}>
              {targets.data.map((t) => <option key={t.id} value={t.id}>{t.name} · {rel[t.relation]}</option>)}
            </select>
          </div>
        )}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

/** Item 57: o último quadro e fase escolhidos ao aceitar; o botão Aceitar da caixa de entrada usa direto. */
const ACCEPT_KEY = 'synctasks.aceitar.destino';
export interface AcceptPlace { listId: string; label: string }
export function acceptPlace(): AcceptPlace | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACCEPT_KEY) ?? 'null');
    return v && typeof v.listId === 'string' && typeof v.label === 'string' ? v : null;
  } catch { return null; }
}
export function saveAcceptPlace(p: AcceptPlace | null) {
  try { if (p) localStorage.setItem(ACCEPT_KEY, JSON.stringify(p)); else localStorage.removeItem(ACCEPT_KEY); } catch { /* sem armazenamento: pergunta toda vez */ }
}

export function AcceptDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const { run, busy, error } = useAction();
  const place = useBoardList();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => post(`/cards/${card.id}/accept`, { listId: place.lId }), `Tarefa colocada em “${place.listName}”.`)) {
      saveAcceptPlace({ listId: place.lId, label: `${place.boardName} · ${place.listName}` });
      onClose();
    }
  };
  return (
    <Dialog title="Aceitar e organizar" onClose={onClose} footer={<Footer busy={busy || !place.lId} onClose={onClose} label="Aceitar" />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}><span className="code">{cardNo(card.num)}</span> {card.title}</p>
        {place.fields}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ title, text, confirm, danger, onConfirm, onClose }: { title: string; text: string; confirm: string; danger?: boolean; onConfirm: () => Promise<unknown>; onClose: Close }) {
  const { run, busy, error } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(onConfirm);
    if (r !== undefined) onClose();
  };
  return (
    <Dialog title={title} onClose={onClose} footer={<Footer busy={busy} onClose={onClose} label={confirm} danger={danger} />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}>{text}</p>
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

export function NameDialog({ title, label, initial = '', confirm, onSave, onClose, saveOnOutside }: { title: string; label: string; initial?: string; confirm: string; onSave: (name: string) => Promise<unknown>; onClose: Close; saveOnOutside?: boolean }) {
  const { run, busy, error } = useAction();
  const [name, setName] = useState(initial);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if ((await run(() => onSave(name))) !== undefined) onClose();
  };
  // Item 77: na fase nova e no quadro novo, clicar fora da janela com o nome digitado cria; vazio, só fecha.
  const outside = saveOnOutside ? () => { if (name.trim() && !busy) void submit(); else if (!name.trim()) onClose(); } : undefined;
  return (
    <Dialog title={title} onClose={onClose} onOutside={outside} footer={<Footer busy={busy} onClose={onClose} label={confirm} />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <div className="field">
          <label htmlFor="n-name">{label}</label>
          <input id="n-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </div>
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}
