import { useMemo, useState } from 'react';
import { Avatar } from './ui';

export interface OrgPerson {
  id: string; name: string; level: number | null; role_title: string; manager_id: string | null; active: boolean; is_admin: boolean;
}

interface Node { p: OrgPerson; kids: Node[] }

/** Item 95: organograma montado só a partir do superior direto de cada pessoa (só no computador). */
export function OrgChart({ people, onOpen }: { people: OrgPerson[]; onOpen: (p: OrgPerson) => void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const { roots, outside } = useMemo(() => {
    const ids = new Set(people.map((p) => p.id));
    const byId = new Map<string, Node>(people.map((p) => [p.id, { p, kids: [] }]));
    const roots: Node[] = [];
    const outside: OrgPerson[] = [];
    const order = (a: Node, b: Node) => (a.p.level ?? 9) - (b.p.level ?? 9) || a.p.name.localeCompare(b.p.name, 'pt-BR');
    for (const n of byId.values()) {
      if (n.p.level === null) { outside.push(n.p); continue; }
      const m = n.p.manager_id && ids.has(n.p.manager_id) ? byId.get(n.p.manager_id)! : null;
      (m ? m.kids : roots).push(n);
    }
    for (const n of byId.values()) n.kids.sort(order);
    roots.sort(order);
    return { roots, outside };
  }, [people]);
  const toggle = (id: string) => setClosed((s) => { const t = new Set(s); if (t.has(id)) t.delete(id); else t.add(id); return t; });
  const count = (n: Node): number => n.kids.reduce((s, k) => s + 1 + count(k), 0);

  const Box = ({ n }: { n: Node }) => (
    <div className={`org-box${n.p.active ? '' : ' off'}`}>
      <button type="button" className="org-card" onClick={() => onOpen(n.p)} title={`Abrir o cadastro de ${n.p.name}`}>
        <Avatar name={n.p.name} />
        <span className="org-txt"><b>{n.p.name}</b><small>{n.p.role_title}{n.p.active ? '' : ' · inativa'}</small></span>
      </button>
      {n.kids.length > 0 && (
        <button type="button" className="org-fold" onClick={() => toggle(n.p.id)} aria-expanded={!closed.has(n.p.id)}>
          {closed.has(n.p.id) ? `+ ${count(n)}` : '−'}
        </button>
      )}
    </div>
  );
  const Branch = ({ n }: { n: Node }) => {
    const open = !closed.has(n.p.id) && n.kids.length > 0;
    const leaves = open && n.kids.every((k) => k.kids.length === 0);
    return (
      <li>
        <Box n={n} />
        {open && (leaves
          ? <ul className="org-stack">{n.kids.map((k) => <li key={k.p.id}><Box n={k} /></li>)}</ul>
          : <ul>{n.kids.map((k) => <Branch key={k.p.id} n={k} />)}</ul>)}
      </li>
    );
  };
  return (
    <div className="org">
      <div className="org-wide"><div className="org-tree"><ul>{roots.map((n) => <Branch key={n.p.id} n={n} />)}</ul></div></div>
      {outside.length > 0 && (
        <div className="org-outside">
          <span className="hint">Fora da hierarquia (só administração):</span>
          {outside.map((p) => <Box key={p.id} n={{ p, kids: [] }} />)}
        </div>
      )}
    </div>
  );
}
