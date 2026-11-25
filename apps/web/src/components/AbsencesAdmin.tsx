import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, type AdminSubstitution } from '../lib/api';
import { fullDate, shortDate } from '../lib/format';
import { Dialog, ErrorText } from './ui';
import { useAction } from './dialogs';
import { SubstitutionBox } from './Substitution';

export interface AbsencesData { today: string; open: AdminSubstitution[]; history: AdminSubstitution[] }

/** Item 76: as substituições de todos, para o quadro de Pessoas e a coluna Ausência. */
export function useAbsences(enabled: boolean) {
  return useQuery({ queryKey: ['admin-substitutions'], queryFn: () => get<AbsencesData>('/admin/substitutions'), enabled });
}

const period = (s: AdminSubstitution) => {
  const from = s.startsOn ? fullDate(s.startsOn) : null;
  const to = s.endsOn ? fullDate(s.endsOn) : null;
  if (s.status === 'scheduled') return to ? `de ${from} a ${to}` : `a partir de ${from}`;
  return to ? `até ${to}` : 'até alguém encerrar';
};

/** Texto curto da coluna Ausência na lista de Pessoas (item 76). */
export function absenceText(personId: string, data?: AbsencesData): string | null {
  if (!data) return null;
  const mine = data.open.find((s) => s.absent.id === personId);
  const covering = data.open.filter((s) => s.substitute.id === personId && s.status === 'active');
  const parts: string[] = [];
  if (mine?.status === 'active') parts.push(`Fora${mine.endsOn ? ` até ${shortDate(mine.endsOn)}` : ''} · ${mine.substitute.name.split(' ')[0]} substitui`);
  if (mine?.status === 'scheduled') parts.push(`Sai em ${shortDate(mine.startsOn!)}`);
  if (covering.length) parts.push(`Substitui ${covering.map((s) => s.absent.name.split(' ')[0]).join(', ')}`);
  return parts.length ? parts.join(' · ') : null;
}

interface PersonLite { id: string; name: string; active: boolean; level: number | null }

/**
 * Item 76: quadro “Férias e ausências” no alto de Pessoas. Mostra quem está fora (ou vai sair), quem substitui,
 * as datas e quem escolheu; dá para criar, alterar, encerrar (ou cancelar a agendada) e ver o histórico.
 */
export function AbsencesBlock({ people, data, error }: { people: PersonLite[]; data?: AbsencesData; error: unknown }) {
  const [edit, setEdit] = useState<null | { id: string; name: string }>(null);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState('');
  const [history, setHistory] = useState(false);
  const { run, busy, error: actError } = useAction();
  const end = (s: AdminSubstitution) =>
    run(() => post('/substitution/end', { userId: s.absent.id }), s.status === 'scheduled' ? 'Substituição agendada cancelada.' : 'Substituição encerrada.');
  const busyIds = new Set(data?.open.map((s) => s.absent.id));
  const choices = people.filter((p) => p.active && p.level !== null && !busyIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="absences" aria-label="Férias e ausências">
      <div className="absences-h">
        <h2>Férias e ausências</h2>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(data?.history.length ?? 0) > 0 && <button className="b ghost" onClick={() => setHistory(true)}>Histórico</button>}
          <button className="b" onClick={() => { setPick(''); setPicking(true); }}>Nova substituição</button>
        </span>
      </div>
      <ErrorText error={error ?? actError} />
      {data && data.open.length === 0 && <p className="hint" style={{ margin: 0 }}>Ninguém fora agora nem com férias agendadas.</p>}
      {data && data.open.length > 0 && (
        <ul className="absences-l">
          {data.open.map((s) => (
            <li key={s.id}>
              <div className="absences-t">
                {s.status === 'scheduled' ? <span className="tag sched">Agendada</span> : <span className="tag on">Em vigor</span>}
                <span><b>{s.absent.name}</b> fora {period(s)} · <b>{s.substitute.name}</b> {s.status === 'scheduled' ? 'vai substituir' : 'substitui'}</span>
                <small className="hint">
                  {s.shareCommon ? 'Compartilha as tarefas comuns' : 'Só delegações e caixa de entrada'} · {s.bySelf ? 'escolhido pela própria pessoa' : `escolhido por ${s.createdByName}`}
                </small>
              </div>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="b ghost" onClick={() => setEdit({ id: s.absent.id, name: s.absent.name })} disabled={busy}>Alterar</button>
                <button className="b" onClick={() => end(s)} disabled={busy}>{s.status === 'scheduled' ? 'Cancelar' : 'Encerrar'}</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <Dialog title="Nova substituição" onClose={() => setPicking(false)} footer={<button className="b" onClick={() => setPicking(false)}>Fechar</button>}>
          <label className="field">
            <span className="label">Quem vai sair</span>
            <select className="select input" value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
              <option value="">Escolha…</option>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {pick && <SubstitutionBox key={pick} userId={pick} name={people.find((p) => p.id === pick)?.name} autoEdit />}
        </Dialog>
      )}
      {edit && (
        <Dialog title={`Substituto de ${edit.name}`} onClose={() => setEdit(null)} footer={<button className="b pri" onClick={() => setEdit(null)}>Pronto</button>}>
          <SubstitutionBox userId={edit.id} name={edit.name} />
        </Dialog>
      )}
      {history && data && (
        <Dialog title="Histórico de substituições" onClose={() => setHistory(false)} footer={<button className="b pri" onClick={() => setHistory(false)}>Fechar</button>}>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Quem saiu</th><th>Substituto</th><th>Período</th><th>Encerrada</th></tr></thead>
              <tbody>
                {data.history.map((s) => (
                  <tr key={s.id}>
                    <td>{s.absent.name}</td>
                    <td>{s.substitute.name}</td>
                    <td>{fullDate((s.startsOn ?? s.createdAt).slice(0, 10))}{s.endsOn ? ` a ${fullDate(s.endsOn)}` : ''}</td>
                    <td>{s.endedAt ? `${fullDate(s.endedAt.slice(0, 10))}${s.endedByName ? ` · ${s.endedByName}` : ''}` : 'Acabou na data'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}
    </section>
  );
}
