import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type Card } from '../lib/api';
import { cardNo, firstName } from '../lib/format';
import { Dialog, ErrorText, useMe, useToast } from './ui';

/** Executa uma ação, mostra o resultado e recarrega os dados da tela. */
export function useAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      await qc.invalidateQueries();
      if (success) toast(success);
      return r;
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
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

export function DelegateDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const me = useMe().data!;
  const { run, busy, error } = useAction();
  const [to, setTo] = useState(me.directReports[0]?.id ?? '');
  const [due, setDue] = useState(card.dueDate ?? '');
  const [note, setNote] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = me.directReports.find((r) => r.id === to)?.name ?? '';
    const r = await run(() => post(`/cards/${card.id}/delegate`, { toUserId: to, suggestedDue: due || null, note }), `Delegada para ${firstName(name)}. Aviso enviado por e-mail.`);
    if (r) onClose();
  };
  return (
    <Dialog title="Delegar tarefa" onClose={onClose} footer={<Footer busy={busy} onClose={onClose} label="Delegar" />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <div className="box"><span className="code">{cardNo(card.num)}</span> <b style={{ fontWeight: 500 }}>{card.title}</b></div>
        <p className="hint">A pessoa recebe um cartão ligado a este, com o número do quadro dela. Você acompanha até dar o ciente.</p>
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
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

export function RedelegateDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const me = useMe().data!;
  const { run, busy, error } = useAction();
  const [to, setTo] = useState(me.directReports.find((r) => r.id !== card.ownerId)?.id ?? me.directReports[0]?.id ?? '');
  const [due, setDue] = useState(card.dueDate ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => post(`/delegations/${card.delegation!.id}/redelegate`, { toUserId: to, suggestedDue: due || null }), 'Tarefa redelegada.')) onClose();
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

export function AcceptDialog({ card, onClose }: { card: Card; onClose: Close }) {
  const { run, busy, error } = useAction();
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => get<{ id: string; name: string }[]>('/boards') });
  const [boardId, setBoardId] = useState('');
  const bId = boardId || boards.data?.[0]?.id || '';
  const board = useQuery({ queryKey: ['board', bId], queryFn: () => get(`/boards/${bId}`), enabled: !!bId });
  const [listId, setListId] = useState('');
  const lists: { id: string; name: string }[] = board.data?.lists ?? [];
  const lId = lists.some((l) => l.id === listId) ? listId : lists[0]?.id ?? '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = lists.find((l) => l.id === lId)?.name;
    if (await run(() => post(`/cards/${card.id}/accept`, { listId: lId }), `Tarefa colocada em “${name}”.`)) onClose();
  };
  return (
    <Dialog title="Aceitar e organizar" onClose={onClose} footer={<Footer busy={busy || !lId} onClose={onClose} label="Aceitar" />}>
      <form id="dlg" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}><span className="code">{cardNo(card.num)}</span> {card.title}</p>
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

export function NameDialog({ title, label, initial = '', confirm, onSave, onClose }: { title: string; label: string; initial?: string; confirm: string; onSave: (name: string) => Promise<unknown>; onClose: Close }) {
  const { run, busy, error } = useAction();
  const [name, setName] = useState(initial);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ((await run(() => onSave(name))) !== undefined) onClose();
  };
  return (
    <Dialog title={title} onClose={onClose} footer={<Footer busy={busy} onClose={onClose} label={confirm} />}>
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
