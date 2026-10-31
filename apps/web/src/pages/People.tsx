import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '../lib/api';
import { Avatar, Dialog, ErrorText, Menu, useMe, useToast } from '../components/ui';
import { SubstitutionBox } from '../components/Substitution';
import { Icon } from '../components/Icons';
import { firstName } from '../lib/format';
import { ConfirmDialog, useAction } from '../components/dialogs';

interface Person {
  id: string; name: string; email: string; level: number | null; role_title: string; manager_id: string | null;
  manager_name: string | null; is_admin: boolean; active: boolean; has_password: boolean; reports: number;
}

const LEVELS = ['CEO', 'Diretor', 'Gestor', 'Funcionário'];
/** Níveis que podem ser superior direto: o gestor responde a diretor ou CEO; o funcionário, a gestor, diretor ou CEO (item 32). */
const managerLevels = (level: number) => (level === 3 ? [2, 1, 0] : level === 2 ? [1, 0] : [level - 1]);
const managerLabel = (level: number) => {
  const t = managerLevels(level).map((l) => LEVELS[l]);
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} ou ${t[t.length - 1]}` : t[0];
};
/** Possíveis superiores, primeiro os do nível logo acima. */
const managerOptions = (people: Person[], level: number) =>
  people.filter((p) => p.active && p.level !== null && managerLevels(level).includes(p.level)).sort((a, b) => b.level! - a.level!);
/** Item 32: com o cargo entre parênteses, porque a lista mistura níveis. */
const managerName = (p: Person) => `${p.name} (${LEVELS[p.level!]})`;

export function PeoplePage() {
  const me = useMe().data!;
  const q = useQuery({ queryKey: ['people'], queryFn: () => get<Person[]>('/admin/users') });
  const [dlg, setDlg] = useState<null | { kind: 'new' } | { kind: 'edit' | 'toggle' | 'deactivate' | 'substitution'; person: Person }>(null);
  const qc = useQueryClient();
  /** Item 66: a escolha fica gravada na conta; a tela muda na hora e o servidor guarda em seguida. */
  const [hideChoice, setHideChoice] = useState<boolean | null>(null);
  const hideInactive = hideChoice ?? me.prefs.hideInactive;
  const setHideInactive = (v: boolean) => {
    setHideChoice(v);
    patch('/me/prefs', { hideInactive: v }).then(() => qc.invalidateQueries({ queryKey: ['me'] }), () => { /* não gravou: vale só nesta visita */ });
  };
  const { run, error } = useAction();
  const toast = useToast();
  if (!me.user.isAdmin) return <div className="page"><div className="empty">Somente a administração acessa esta tela.</div></div>;
  const people = q.data ?? [];
  const shown = hideInactive ? people.filter((p) => p.active) : people;
  const inactive = people.filter((p) => !p.active).length;
  return (
    <div className="page">
      <div className="page-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="hint">Cadastro, edição dos dados e do superior direto. Veja o passo a passo em Ajuda → Manual do administrador.</span>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {inactive > 0 && (
            <label className="check"><input type="checkbox" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} />Esconder inativas ({inactive})</label>
          )}
          <button className="b pri" onClick={() => setDlg({ kind: 'new' })}><Icon name="plus" />Nova pessoa</button>
        </span>
      </div>
      <ErrorText error={error} />
      {q.isLoading && <p className="loading">Carregando…</p>}
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Pessoa</th><th>Cargo</th><th>Superior direto</th><th>Subordinados</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'off'}>
                <td>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Avatar name={p.name} />
                    <div style={{ minWidth: 0 }}><div>{p.name}{p.is_admin && <span className="hint"> · admin</span>}</div><div className="hint">{p.email}</div></div>
                  </div>
                </td>
                <td>{p.role_title}</td>
                <td>{p.manager_name ?? '—'}</td>
                <td className="code" style={{ color: 'inherit' }}>{p.level === null ? '—' : p.reports}</td>
                <td>{!p.active ? 'Inativa' : p.has_password ? 'Ativa' : <span className="muted">Convite enviado</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  <Menu label={`Ações para ${p.name}`} items={[
                    { label: 'Editar dados', onClick: () => setDlg({ kind: 'edit', person: p }) },
                    // Item 72: para quem saiu de surpresa e não escolheu substituto.
                    { label: 'Substituto em férias e ausências', onClick: () => setDlg({ kind: 'substitution', person: p }), disabled: !p.active || p.level === null },
                    { label: 'Reenviar convite', onClick: () => run(() => post(`/admin/users/${p.id}/invite`), `Convite reenviado para ${p.email}.`), disabled: !p.active },
                    { label: p.active ? 'Desativar' : 'Reativar', onClick: () => setDlg({ kind: p.active ? 'deactivate' : 'toggle', person: p }), danger: p.active, disabled: p.id === me.user.id },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>Ao trocar o superior direto em Editar dados, as delegações em aberto passam ao novo superior e o histórico fica com o antigo.</p>

      {dlg?.kind === 'new' && <NewPersonDialog people={people} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'edit' && <EditPersonDialog person={dlg.person} people={people} self={dlg.person.id === me.user.id} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'substitution' && (
        <Dialog title={`Substituto de ${dlg.person.name}`} onClose={() => setDlg(null)} footer={<button className="b pri" onClick={() => setDlg(null)}>Pronto</button>}>
          <SubstitutionBox userId={dlg.person.id} name={dlg.person.name} />
        </Dialog>
      )}
      {dlg?.kind === 'deactivate' && <DeactivateDialog person={dlg.person} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'toggle' && (
        <ConfirmDialog title="Reativar pessoa" confirm="Reativar"
          text={`${dlg.person.name} volta a acessar o app e encontra os quadros e as tarefas privadas como deixou. O que foi passado adiante na desativação (subordinados, delegações e tarefas abertas) não volta sozinho.`}
          onConfirm={async () => { const r = await post(`/admin/users/${dlg.person.id}/active`, { active: true }); toast('Pessoa reativada.'); return r; }}
          onClose={() => setDlg(null)} />
      )}
    </div>
  );
}

function NewPersonDialog({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<string>('3');
  const [roleTitle, setRoleTitle] = useState('');
  const [managerId, setManagerId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const lv = level === 'admin' ? null : Number(level);
  const managers = lv !== null && lv > 0 ? managerOptions(people, lv) : [];
  const mId = managers.some((m) => m.id === managerId) ? managerId : managers[0]?.id ?? '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(
      () => post('/admin/users', { name, email, level: lv, roleTitle: roleTitle || undefined, managerId: lv && lv > 0 ? mId : null, isAdmin: lv === null ? true : isAdmin }),
      `Pessoa cadastrada. O link para definir a senha foi enviado para ${email}.`,
    );
    if (r) onClose();
  };
  return (
    <Dialog title="Nova pessoa" onClose={onClose} footer={<>
      <button className="b" onClick={onClose}>Cancelar</button>
      <button className="b pri" type="submit" form="np" disabled={busy}>Cadastrar</button>
    </>}>
      <form id="np" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <div className="field"><label htmlFor="np-n">Nome</label><input id="np-n" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field"><label htmlFor="np-e">E-mail</label><input id="np-e" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="nome@empresa.com.br" /></div>
        <div className="row2">
          <div className="field">
            <label htmlFor="np-l">Nível</label>
            <select id="np-l" className="select input" value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((l, i) => <option key={l} value={String(i)}>{l}</option>)}
              <option value="admin">Só administração (fora da hierarquia)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="np-r">Cargo exibido (opcional)</label>
            <input id="np-r" className="input" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder={lv === null ? 'Administrador' : LEVELS[lv]} />
          </div>
        </div>
        {lv !== null && lv > 0 && (
          <div className="field">
            <label htmlFor="np-m">Superior direto ({managerLabel(lv)})</label>
            <select id="np-m" className="select input" value={mId} onChange={(e) => setManagerId(e.target.value)} required>
              {managers.length === 0 && <option value="">Cadastre antes um {managerLabel(lv)}</option>}
              {managers.map((m) => <option key={m.id} value={m.id}>{managerName(m)}</option>)}
            </select>
          </div>
        )}
        {lv !== null && <label className="check"><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />Também é administrador</label>}
        <p className="hint">A pessoa recebe um e-mail com o link para definir a senha.</p>
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

/** Item 25: nome, e-mail, cargo e administrador. Item 33: o superior direto também muda aqui (faz a transferência de gestão). */
function EditPersonDialog({ person, people, self, onClose }: { person: Person; people: Person[]; self: boolean; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const toast = useToast();
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email);
  const [roleTitle, setRoleTitle] = useState(person.role_title);
  const [isAdmin, setIsAdmin] = useState(person.is_admin);
  const [managerId, setManagerId] = useState(person.manager_id ?? '');
  const onlyAdmin = person.level === null;
  const hasManager = !onlyAdmin && person.level! > 0;
  const managers = hasManager ? managerOptions(people, person.level!) : [];
  const oldManager = person.manager_name ?? 'o superior atual';
  const managerChanged = hasManager && !!managerId && managerId !== person.manager_id;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (name.trim() !== person.name) changes.name = name.trim();
    if (email.trim().toLowerCase() !== person.email.toLowerCase()) changes.email = email.trim();
    if (roleTitle.trim() !== person.role_title) changes.roleTitle = roleTitle.trim();
    if (isAdmin !== person.is_admin) changes.isAdmin = isAdmin;
    if (managerChanged) changes.managerId = managerId;
    if (!Object.keys(changes).length) { onClose(); return; }
    const r = await run(() => patch<{ moved: number | null }>(`/admin/users/${person.id}`, changes));
    if (!r) return;
    toast(r.moved === null ? 'Dados salvos.'
      : `Dados salvos. ${firstName(person.name)} agora responde a ${people.find((p) => p.id === managerId)?.name}; ${r.moved} ${r.moved === 1 ? 'delegação em aberto passou' : 'delegações em aberto passaram'} para o novo superior.`);
    onClose();
  };
  return (
    <Dialog title="Editar dados" onClose={onClose} footer={<>
      <button className="b" onClick={onClose}>Cancelar</button>
      <button className="b pri" type="submit" form="ep" disabled={busy}>Salvar</button>
    </>}>
      <form id="ep" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <div className="field"><label htmlFor="ep-n">Nome</label><input id="ep-n" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></div>
        <div className="field">
          <label htmlFor="ep-e">E-mail</label>
          <input id="ep-e" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} />
          <span className="hint">É o e-mail usado para entrar no app e receber os avisos.</span>
        </div>
        <div className="row2">
          <div className="field">
            <span className="label">Nível</span>
            <span>{onlyAdmin ? 'Só administração' : LEVELS[person.level!]}</span>
          </div>
          <div className="field">
            <label htmlFor="ep-r">Cargo exibido</label>
            <input id="ep-r" className="input" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} required maxLength={80} />
          </div>
        </div>
        {hasManager && (
          <div className="field">
            <label htmlFor="ep-m">Superior direto ({managerLabel(person.level!)})</label>
            <select id="ep-m" className="select input" value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={!person.active}>
              {person.manager_id && !managers.some((m) => m.id === person.manager_id) && <option value={person.manager_id}>{person.manager_name}</option>}
              {managers.map((m) => <option key={m.id} value={m.id}>{managerName(m)}</option>)}
            </select>
            {!person.active && <span className="hint">Reative a pessoa para trocar o superior.</span>}
            {managerChanged && (
              <p className="hint" style={{ margin: '6px 0 0' }}>
                Ao salvar, as delegações em aberto de {oldManager} para esta pessoa passam ao novo superior. O histórico e as tarefas arquivadas ficam com {oldManager}.
              </p>
            )}
          </div>
        )}
        {!onlyAdmin && (
          <label className="check">
            <input type="checkbox" checked={isAdmin} disabled={self && person.is_admin} onChange={(e) => setIsAdmin(e.target.checked)} />
            Também é administrador
          </label>
        )}
        {self && person.is_admin && <p className="hint">Você não pode tirar o seu próprio acesso de administrador.</p>}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

interface Preview {
  reports: number; delegated: number; received: number; awaiting: number; own: number; private: number;
  needsSuccessor: boolean;
  successors: { id: string; name: string; role_title: string; level: number; relation: 'peer' | 'manager' }[];
}

/** Item 44: desativar mostra as pendências e resolve tudo numa vez só; nada é apagado e a pessoa pode ser reativada. */
function DeactivateDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const toast = useToast();
  const q = useQuery({ queryKey: ['deactivation', person.id], queryFn: () => get<Preview>(`/admin/users/${person.id}/deactivation`) });
  const [successorId, setSuccessorId] = useState('');
  const p = q.data;
  const first = firstName(person.name);
  const sId = p?.successors.some((x) => x.id === successorId) ? successorId : p?.successors[0]?.id ?? '';
  const succName = p?.successors.find((x) => x.id === sId)?.name ?? 'o sucessor';
  const blocked = !!p && p.needsSuccessor && !p.successors.length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => post<{ reports: number; delegated: number; returned: number; own: number }>(`/admin/users/${person.id}/deactivate`, { successorId: p?.needsSuccessor ? sId : null }));
    if (!r) return;
    toast(`${first} foi desativado(a).${p?.needsSuccessor ? ` As pendências foram para ${firstName(succName)}.` : ''}`);
    onClose();
  };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const v = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return (
    <Dialog title="Desativar pessoa" onClose={onClose} footer={<>
      <button className="b" onClick={onClose}>Cancelar</button>
      <button className="b danger" type="submit" form="dp" disabled={busy || !p || blocked}>{busy ? 'Aguarde…' : 'Desativar'}</button>
    </>}>
      <form id="dp" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}>{person.name} deixa de entrar no app na hora. Nada é apagado: o log continua com o nome dela e ela pode ser reativada depois.</p>
        {q.isLoading && <p className="loading">Conferindo as pendências…</p>}
        <ErrorText error={q.error} />
        {p && p.needsSuccessor && (
          <div className="field">
            <label htmlFor="dp-s">Quem recebe as pendências</label>
            {blocked
              ? <p className="err" style={{ margin: 0 }}>Não há ninguém do mesmo nível nem superior direto para receber as pendências. Cadastre antes quem vai assumir.</p>
              : (
                <select id="dp-s" className="select input" value={sId} onChange={(e) => setSuccessorId(e.target.value)}>
                  {p.successors.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.relation === 'manager' ? 'superior direto' : x.role_title})</option>)}
                </select>
              )}
          </div>
        )}
        {p && (
          <ul className="pend">
            {p.reports > 0 && <li><b>{plural(p.reports, 'subordinado direto', 'subordinados diretos')}</b> {v(p.reports, 'passa', 'passam')} a responder a {succName}.</li>}
            {p.delegated > 0 && <li><b>{plural(p.delegated, 'delegação feita por ' + first + ' e em aberto', 'delegações feitas por ' + first + ' e em aberto')}</b> {v(p.delegated, 'passa a ser acompanhada', 'passam a ser acompanhadas')} por {succName}.</li>}
            {p.own > 0 && <li><b>{plural(p.own, 'tarefa própria aberta', 'tarefas próprias abertas')}</b> {v(p.own, 'vai', 'vão')} para a caixa de entrada de {succName}.</li>}
            {p.received > 0 && <li><b>{plural(p.received, 'tarefa recebida e não terminada', 'tarefas recebidas e não terminadas')}</b> {v(p.received, 'volta para quem delegou, como devolvida', 'voltam para quem delegou, como devolvidas')}.</li>}
            {p.awaiting > 0 && <li><b>{plural(p.awaiting, 'tarefa concluída aguardando ciente', 'tarefas concluídas aguardando ciente')}</b> {v(p.awaiting, 'fica', 'ficam')} para o ciente de quem delegou.</li>}
            {p.private > 0 && <li><b>{plural(p.private, 'tarefa privada', 'tarefas privadas')}</b> {v(p.private, 'fica', 'ficam')} com {first}, sem passar para ninguém.</li>}
            <li>Os quadros, as tarefas concluídas, as arquivadas e o log ficam com {first}. Todos os envolvidos recebem aviso.</li>
          </ul>
        )}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}
