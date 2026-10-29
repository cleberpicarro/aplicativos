import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, type Substitution } from '../lib/api';
import { fullDate } from '../lib/format';
import { useAction } from './dialogs';
import { ErrorText } from './ui';

interface Overview {
  current: Substitution | null;
  candidates: { id: string; name: string; roleTitle: string; level: number | null; absent: boolean }[];
  today: string;
}

/**
 * Item 72: escolher quem substitui a pessoa em férias ou ausência. Em Meus dados (a própria pessoa)
 * e em Pessoas (a administração, com `userId`, para quem saiu de surpresa).
 */
export function SubstitutionBox({ userId, name }: { userId?: string; name?: string }) {
  const self = !userId;
  const q = useQuery({
    queryKey: ['substitution', userId ?? 'me'],
    queryFn: () => get<Overview>(`/substitution${userId ? `?userId=${userId}` : ''}`),
  });
  const { run, busy, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [substituteId, setSubstituteId] = useState('');
  const [share, setShare] = useState(false);
  const [endsOn, setEndsOn] = useState('');
  const who = self ? 'você' : (name ?? 'a pessoa');
  const whose = self ? 'suas' : `de ${name ?? 'a pessoa'}`;

  if (q.isLoading) return <p className="loading">Carregando…</p>;
  if (q.error || !q.data) return <ErrorText error={q.error} />;
  const { current, candidates, today } = q.data;

  const edit = () => {
    setSubstituteId(current?.substitute.id ?? '');
    setShare(current?.shareCommon ?? false);
    setEndsOn(current?.endsOn ?? '');
    setEditing(true);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const sub = candidates.find((c) => c.id === substituteId);
    const ok = await run(
      () => post('/substitution', { ...(userId ? { userId } : {}), substituteId, shareCommon: share, endsOn: endsOn || null }),
      `${sub?.name ?? 'O substituto'} vai substituir ${who} e recebe um aviso.`,
    );
    if (ok) setEditing(false);
  };
  const end = () => run(() => post('/substitution/end', userId ? { userId } : {}), 'Substituição encerrada.');

  return (
    <fieldset className="my-mail my-sub">
      <legend>Férias e ausências</legend>
      {current && !editing ? (
        <>
          <p className="sub-now">
            <b>{current.substitute.name}</b> substitui {who}{current.endsOn ? <> até <b>{fullDate(current.endsOn)}</b></> : ' até alguém encerrar'}.
            <small>
              {current.shareCommon ? `Vê as tarefas comuns e as delegações, menos as privadas.` : `Vê só as delegações e o que chegou de outras pessoas; as tarefas comuns e as privadas ficam escondidas.`}
              {current.createdByName && !self ? ` Ligada por ${current.createdByName}.` : ''}
            </small>
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="b" onClick={end} disabled={busy}>Encerrar substituição</button>
            <button type="button" className="b ghost" onClick={edit} disabled={busy}>Alterar</button>
          </div>
        </>
      ) : !editing ? (
        <>
          <p className="hint" style={{ margin: 0 }}>
            Vai sair de férias ou se ausentar? Escolha quem cuida das {whose} delegações e da caixa de entrada enquanto isso. As tarefas privadas nunca aparecem para o substituto.
          </p>
          <div><button type="button" className="b" onClick={edit}>Escolher substituto</button></div>
        </>
      ) : (
        <form onSubmit={save} className="sub-form">
          <label className="field">
            <span className="label">Quem substitui {who}</span>
            <select className="select input" value={substituteId} onChange={(e) => setSubstituteId(e.target.value)} required>
              <option value="">Escolha…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.roleTitle}{c.absent ? ' (também ausente)' : ''}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>Compartilhar as tarefas comuns<small>Sem marcar, o substituto vê só as tarefas ligadas a delegações, as que chegaram de outras pessoas e as que ele mesmo criar. Marcando, vê também as tarefas comuns. As <b>privadas nunca</b> aparecem: antes de sair, marque como privado o que for particular.</small></span>
          </label>
          <label className="field">
            <span className="label">Último dia fora (opcional)</span>
            <input className="input" type="date" min={today} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            <span className="hint">No dia seguinte a substituição acaba sozinha. Sem data, vale até alguém encerrar.</span>
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="submit" className="b pri" disabled={busy || !substituteId}>{current ? 'Salvar' : 'Ligar substituição'}</button>
            <button type="button" className="b ghost" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
          </div>
        </form>
      )}
      <ErrorText error={error} />
    </fieldset>
  );
}
