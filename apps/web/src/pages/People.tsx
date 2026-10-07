import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, patch, post } from '../lib/api';
import { Avatar, Dialog, ErrorText, Menu, useMe, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { ConfirmDialog, useAction } from '../components/dialogs';

interface Person {
  id: string; name: string; email: string; level: number | null; role_title: string; manager_id: string | null;
  manager_name: string | null; is_admin: boolean; active: boolean; has_password: boolean; reports: number;
}

const LEVELS = ['CEO', 'Diretor', 'Gestor', 'Funcionário'];
/** Níveis que podem ser superior direto: o nível logo acima; o gestor também pode responder ao CEO. */
const managerLevels = (level: number) => (level === 2 ? [1, 0] : [level - 1]);
const managerLabel = (level: number) => managerLevels(level).map((l) => LEVELS[l]).join(' ou ');
/** Possíveis superiores, primeiro os do nível logo acima. */
const managerOptions = (people: Person[], level: number) =>
  people.filter((p) => p.active && p.level !== null && managerLevels(level).includes(p.level)).sort((a, b) => b.level! - a.level!);
const managerName = (p: Person) => (p.level === 0 ? `${p.name} (CEO)` : p.name);

export function PeoplePage() {
  const me = useMe().data!;
  const q = useQuery({ queryKey: ['people'], queryFn: () => get<Person[]>('/admin/users') });
  const [dlg, setDlg] = useState<null | { kind: 'new' } | { kind: 'edit' | 'move' | 'toggle'; person: Person }>(null);
  const { run, error } = useAction();
  const toast = useToast();
  if (!me.user.isAdmin) return <div className="page"><div className="empty">Somente a administração acessa esta tela.</div></div>;
  const people = q.data ?? [];
  return (
    <div className="page">
      <div className="page-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="hint">Cadastro, edição dos dados, superior direto e transferência de gestão. Veja o passo a passo em Ajuda → Manual do administrador.</span>
        <button className="b pri" onClick={() => setDlg({ kind: 'new' })}><Icon name="plus" />Nova pessoa</button>
      </div>
      <ErrorText error={error} />
      {q.isLoading && <p className="loading">Carregando…</p>}
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Pessoa</th><th>Cargo</th><th>Superior direto</th><th>Subordinados</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
          <tbody>
            {people.map((p) => (
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
                    { label: 'Transferir gestão', onClick: () => setDlg({ kind: 'move', person: p }), disabled: !p.active || p.level === null || p.level === 0 },
                    { label: 'Reenviar convite', onClick: () => run(() => post(`/admin/users/${p.id}/invite`), `Convite reenviado para ${p.email}.`), disabled: !p.active },
                    { label: p.active ? 'Desativar' : 'Reativar', onClick: () => setDlg({ kind: 'toggle', person: p }), danger: p.active, disabled: p.id === me.user.id },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>Ao transferir a gestão, as delegações em aberto passam ao novo superior e o histórico fica com o antigo.</p>

      {dlg?.kind === 'new' && <NewPersonDialog people={people} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'edit' && <EditPersonDialog person={dlg.person} self={dlg.person.id === me.user.id} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'move' && <MoveDialog person={dlg.person} people={people} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'toggle' && (
        <ConfirmDialog
          title={dlg.person.active ? 'Desativar pessoa' : 'Reativar pessoa'}
          confirm={dlg.person.active ? 'Desativar' : 'Reativar'}
          danger={dlg.person.active}
          text={dlg.person.active
            ? `${dlg.person.name} deixa de acessar o app. Os registros no log são mantidos.`
            : `${dlg.person.name} volta a acessar o app.`}
          onConfirm={async () => { const r = await post(`/admin/users/${dlg.person.id}/active`, { active: !dlg.person.active }); toast(dlg.person.active ? 'Pessoa desativada.' : 'Pessoa reativada.'); return r; }}
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

/** Item 25: nome, e-mail, cargo e administrador. O superior muda por “Transferir gestão”, porque mexe nas delegações. */
function EditPersonDialog({ person, self, onClose }: { person: Person; self: boolean; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email);
  const [roleTitle, setRoleTitle] = useState(person.role_title);
  const [isAdmin, setIsAdmin] = useState(person.is_admin);
  const onlyAdmin = person.level === null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (name.trim() !== person.name) changes.name = name.trim();
    if (email.trim().toLowerCase() !== person.email.toLowerCase()) changes.email = email.trim();
    if (roleTitle.trim() !== person.role_title) changes.roleTitle = roleTitle.trim();
    if (isAdmin !== person.is_admin) changes.isAdmin = isAdmin;
    if (!Object.keys(changes).length) { onClose(); return; }
    const r = await run(() => patch(`/admin/users/${person.id}`, changes), 'Dados salvos.');
    if (r) onClose();
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
        {!onlyAdmin && (
          <label className="check">
            <input type="checkbox" checked={isAdmin} disabled={self && person.is_admin} onChange={(e) => setIsAdmin(e.target.checked)} />
            Também é administrador
          </label>
        )}
        {self && person.is_admin && <p className="hint">Você não pode tirar o seu próprio acesso de administrador.</p>}
        {!onlyAdmin && <p className="hint">Para trocar o superior direto, use “Transferir gestão” no menu da pessoa.</p>}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}

function MoveDialog({ person, people, onClose }: { person: Person; people: Person[]; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const toast = useToast();
  const options = managerOptions(people, person.level ?? 1).filter((p) => p.id !== person.manager_id);
  const [to, setTo] = useState(options[0]?.id ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => post<{ moved: number }>(`/admin/users/${person.id}/transfer-management`, { managerId: to }));
    if (r) {
      toast(`Gestão transferida. ${r.moved} ${r.moved === 1 ? 'delegação em aberto passou' : 'delegações em aberto passaram'} para o novo superior.`);
      onClose();
    }
  };
  return (
    <Dialog title="Transferir gestão" onClose={onClose} footer={<>
      <button className="b" onClick={onClose}>Cancelar</button>
      <button className="b pri" type="submit" form="mv" disabled={busy || !to}>Transferir</button>
    </>}>
      <form id="mv" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <p style={{ margin: 0 }}><b style={{ fontWeight: 500 }}>{person.name}</b> hoje responde a {person.manager_name}.</p>
        {options.length === 0 ? <p className="err">Não há outro {managerLabel(person.level ?? 1)} ativo para assumir.</p> : (
          <div className="field">
            <label htmlFor="mv-to">Novo superior direto</label>
            <select id="mv-to" className="select input" value={to} onChange={(e) => setTo(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{managerName(o)}</option>)}
            </select>
          </div>
        )}
        <p className="hint">As delegações em aberto de {person.manager_name} para esta pessoa passam ao novo superior. O histórico e as tarefas arquivadas ficam com {person.manager_name}.</p>
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}
