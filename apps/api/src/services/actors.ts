import { one, many, type Db } from '../lib/db.js';

export interface Actor {
  id: string;
  name: string;
  email: string;
  level: number | null;
  roleTitle: string;
  managerId: string | null;
  isAdmin: boolean;
}

export function toActor(row: any): Actor {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    level: row.level,
    roleTitle: row.role_title,
    managerId: row.manager_id,
    isAdmin: row.is_admin,
  };
}

export async function getUser(db: Db, id: string) {
  return one(db, 'SELECT * FROM users WHERE id = $1', [id]);
}

export async function directReports(db: Db, managerId: string) {
  return many(db, `SELECT id, name, role_title, level FROM users WHERE manager_id = $1 AND active ORDER BY name`, [managerId]);
}

export async function isDirectReport(db: Db, managerId: string, userId: string): Promise<boolean> {
  const r = await one(db, 'SELECT 1 FROM users WHERE id = $1 AND manager_id = $2 AND active', [userId, managerId]);
  return !!r;
}

/** Algum dos usuários informados está na subárvore de `rootId` (incluindo o próprio)? */
export async function anyInSubtree(db: Db, rootId: string, userIds: (string | null)[]): Promise<boolean> {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return false;
  const r = await one(
    db,
    `WITH RECURSIVE t AS (
       SELECT id FROM users WHERE id = $1
       UNION ALL SELECT u.id FROM users u JOIN t ON u.manager_id = t.id
     ) SELECT 1 FROM t WHERE id = ANY($2::uuid[]) LIMIT 1`,
    [rootId, ids],
  );
  return !!r;
}

/**
 * Quem vê o log: administrador e CEO veem todas as tarefas; diretor vê as da própria diretoria
 * (detentor ou delegador na subárvore dele). Tarefas privadas não são expostas a ninguém além do dono.
 */
export async function canSeeLog(db: Db, actor: Actor, card: { owner_id: string; is_private: boolean; delegator_id?: string | null }): Promise<boolean> {
  if (card.is_private) return false;
  if (actor.isAdmin || actor.level === 0) return true;
  if (actor.level === 1) return anyInSubtree(db, actor.id, [card.owner_id, card.delegator_id ?? null]);
  return false;
}
