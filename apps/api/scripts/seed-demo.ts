/**
 * Dados de demonstração (somente para desenvolvimento): a mesma equipe do protótipo.
 * Todos os usuários recebem a senha "nerus2026". Só roda em banco sem usuários.
 */
import { config } from '../src/config.js';
import { createPool, tx, one, type Db } from '../src/lib/db.js';
import { migrate } from '../src/lib/migrate.js';
import { hashPassword } from '../src/lib/passwords.js';
import { createUser } from '../src/services/admin.js';
import { toActor, type Actor } from '../src/services/actors.js';
import { createCard, updateCard, completeCard } from '../src/services/tasks.js';
import { delegate, accept, decline } from '../src/services/delegation.js';

export const DEMO_PASSWORD = 'nerus2026';

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function actor(db: Db, email: string): Promise<Actor> {
  return toActor(await one(db, 'SELECT * FROM users WHERE email = $1', [email]));
}
async function firstList(db: Db, a: Actor, name: string) {
  return (await one(db, `SELECT l.id FROM lists l JOIN boards b ON b.id = l.board_id WHERE b.owner_id = $1 AND l.name = $2 ORDER BY l.position LIMIT 1`, [a.id, name])).id as string;
}
async function task(db: Db, a: Actor, list: string, title: string, due?: number, extra: { description?: string; isPrivate?: boolean } = {}) {
  const c = await createCard(db, a, await firstList(db, a, list), title);
  if (due !== undefined || extra.description || extra.isPrivate) {
    await updateCard(db, a, c.id, { dueDate: due === undefined ? undefined : addDays(due), description: extra.description, isPrivate: extra.isPrivate });
  }
  return c.id as string;
}

export async function seedDemo(db: Db) {
  const exists = await one(db, 'SELECT count(*)::int AS n FROM users');
  if (exists.n > 0) return false;
  const people: [string, string, number | null, string | null, boolean?][] = [
    ['Renata Souza', 'renata@nerus.com.br', null, null, true],
    ['Helena Duarte', 'helena@nerus.com.br', 0, null],
    ['Carlos Menezes', 'carlos@nerus.com.br', 1, 'helena@nerus.com.br'],
    ['Paulo Ribeiro', 'paulo@nerus.com.br', 2, 'carlos@nerus.com.br'],
    ['Marina Teixeira', 'marina@nerus.com.br', 2, 'carlos@nerus.com.br'],
    ['João Alves', 'joao@nerus.com.br', 3, 'marina@nerus.com.br'],
    ['Beatriz Lima', 'beatriz@nerus.com.br', 3, 'marina@nerus.com.br'],
    ['Lucas Prado', 'lucas@nerus.com.br', 3, 'paulo@nerus.com.br'],
  ];
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const [name, email, level, managerEmail, isAdmin] of people) {
    const managerId = managerEmail ? (await one(db, 'SELECT id FROM users WHERE email = $1', [managerEmail])).id : null;
    const { user } = await createUser(db, { name, email, level, managerId, isAdmin, roleTitle: level === 2 && name.startsWith('Marina') ? 'Gestora' : undefined });
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
  }
  await db.query('DELETE FROM email_outbox');

  const actors: Actor[] = [];
  for (const n of ['helena', 'carlos', 'paulo', 'marina', 'joao', 'beatriz', 'lucas']) actors.push(await actor(db, `${n}@nerus.com.br`));
  const [helena, carlos, paulo, marina, joao, beatriz, lucas] = actors;

  // Helena (CEO) delega a Carlos
  const h1 = await task(db, helena, 'A fazer', 'Plano estratégico 2027: metas por diretoria', 14);
  const d1 = await delegate(db, helena, h1, { toUserId: carlos.id, note: 'Quero a proposta consolidada antes da reunião de conselho.' });
  await accept(db, carlos, d1.cardId, await firstList(db, carlos, 'Fazendo'));
  await task(db, helena, 'A fazer', 'Reunião de conselho de novembro', 12);

  // Carlos (Diretor) delega a Marina e a Paulo
  const c1 = await task(db, carlos, 'A fazer', 'Fechar orçamento 2027 do time', 4, { description: 'Orçamento por área, com ferramentas e treinamentos.' });
  const dm1 = await delegate(db, carlos, c1, { toUserId: marina.id });
  await accept(db, marina, dm1.cardId, await firstList(db, marina, 'Fazendo'));
  const c2 = await task(db, carlos, 'A fazer', 'Consolidar indicadores de setembro', -2);
  const dm2 = await delegate(db, carlos, c2, { toUserId: marina.id });
  await accept(db, marina, dm2.cardId, await firstList(db, marina, 'Feito'));
  await completeCard(db, marina, dm2.cardId);
  const c3 = await task(db, carlos, 'A fazer', 'Definir metas do time para o 1º trimestre', 9, { description: 'Metas por pessoa, com indicador e prazo.' });
  await delegate(db, carlos, c3, { toUserId: marina.id });
  const c4 = await task(db, carlos, 'A fazer', 'Plano de capacidade do 1º trimestre', 10);
  const dp1 = await delegate(db, carlos, c4, { toUserId: paulo.id });
  await accept(db, paulo, dp1.cardId, await firstList(db, paulo, 'Fazendo'));
  const c5 = await task(db, carlos, 'A fazer', 'Responder auditoria interna', -3);
  const dp2 = await delegate(db, carlos, c5, { toUserId: paulo.id });
  await accept(db, paulo, dp2.cardId, await firstList(db, paulo, 'A fazer'));
  await task(db, carlos, 'A fazer', 'Alinhar orçamento com o financeiro', 3);
  await task(db, carlos, 'A fazer', 'Conversa de feedback com gestores', undefined, { isPrivate: true });

  // Marina (Gestora) repassa o orçamento a João e delega outras tarefas
  await delegate(db, marina, dm1.cardId, { toUserId: joao.id, suggestedDue: addDays(2), note: 'Preciso do total por categoria para fechar o orçamento.' });
  const j1 = (await one(db, `SELECT c.id FROM cards c JOIN delegations d ON d.card_id = c.id WHERE d.parent_card_id = $1`, [dm1.cardId])).id;
  await accept(db, joao, j1, await firstList(db, joao, 'Fazendo'));
  const m1 = await task(db, marina, 'A fazer', 'Atualizar planilha de indicadores', -1);
  const dj1 = await delegate(db, marina, m1, { toUserId: joao.id });
  await accept(db, joao, dj1.cardId, await firstList(db, joao, 'A fazer'));
  const m2 = await task(db, marina, 'A fazer', 'Enviar relatório semanal', -1);
  const dj2 = await delegate(db, marina, m2, { toUserId: joao.id });
  await accept(db, joao, dj2.cardId, await firstList(db, joao, 'Feito'));
  await completeCard(db, joao, dj2.cardId);
  const m3 = await task(db, marina, 'A fazer', 'Conferir notas fiscais de setembro', 3, { description: 'Cruzar as notas com o extrato e listar divergências.' });
  await delegate(db, marina, m3, { toUserId: joao.id });
  const m4 = await task(db, marina, 'A fazer', 'Mapear processos de atendimento', 0);
  const db1 = await delegate(db, marina, m4, { toUserId: beatriz.id });
  await accept(db, beatriz, db1.cardId, await firstList(db, beatriz, 'Fazendo'));
  const m5 = await task(db, marina, 'A fazer', 'Treinar equipe nova', 2);
  const db2 = await delegate(db, marina, m5, { toUserId: beatriz.id });
  await decline(db, beatriz, db2.cardId, 'Prazo inviável: estarei de férias de 7 a 14.');
  await task(db, marina, 'A fazer', 'Revisar contrato do fornecedor', -2);
  await task(db, marina, 'A fazer', 'Avaliação de desempenho (rascunho)', undefined, { isPrivate: true });

  // Paulo repassa a Lucas; tarefas próprias dos funcionários
  await delegate(db, paulo, dp1.cardId, { toUserId: lucas.id });
  await task(db, joao, 'A fazer', 'Estudar o novo módulo do sistema', 7);
  await task(db, beatriz, 'A fazer', 'Organizar arquivos do time', 5);
  await task(db, beatriz, 'A fazer', 'Ideias para o próximo semestre', undefined, { isPrivate: true });
  await task(db, lucas, 'A fazer', 'Revisar base de conhecimento', 4);

  await db.query('DELETE FROM email_outbox');
  return true;
}

if (process.argv[1]?.endsWith('seed-demo.ts')) {
  const pool = createPool(config.databaseUrl);
  await migrate(pool, console.log);
  const done = await tx(pool, seedDemo);
  console.log(done ? `Dados de demonstração criados. Senha de todos: ${DEMO_PASSWORD}` : 'O banco já tem usuários; nada foi alterado.');
  await pool.end();
}
