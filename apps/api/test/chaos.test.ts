/**
 * Frente 4 do plano de testes: "uso caótico".
 * Um robô sorteia milhares de ações (criar, delegar, aceitar, devolver, concluir, reabrir, dar ciente,
 * cancelar, redelegar, transferir, mover, arquivar, tornar privada…) entre as pessoas da hierarquia e,
 * de tempos em tempos, confere regras que nunca podem ser quebradas.
 *
 * O sorteio é reproduzível: se falhar, a mensagem mostra a "semente" e as últimas ações.
 * Para rodar mais pesado: CHAOS_STEPS=5000 CHAOS_SEEDS=1,2,3,4,5 npm test -w apps/api -- chaos
 */
import { describe, it, expect } from 'vitest';
import { setup, api, firstListOf, day, type Ctx } from './helpers.js';

const STEPS = Number(process.env.CHAOS_STEPS ?? 400);
const SEEDS = (process.env.CHAOS_SEEDS ?? '11,22,33').split(',').map(Number);
const CHECK_EVERY = 25;
const PEOPLE = ['ceo', 'dir', 'dir2', 'gest', 'gest2', 'gest3', 'func', 'func2', 'func3'];

/** Gerador pseudoaleatório simples e reproduzível (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)], chance: (p: number) => next() < p };
}

async function runChaos(seed: number) {
  const ctx: Ctx = await setup();
  const call = api(ctx);
  const r = rng(seed);
  const history: string[] = [];
  const serverErrors: string[] = [];
  let eventsSeen = 0;
  let eventsHash = 'd41d8cd98f00b204e9800998ecf8427e'; // md5 de texto vazio: ainda sem eventos conferidos
  const stats: Record<string, number> = {};

  const q = async (sql: string, params: unknown[] = []) => (await ctx.pool.query(sql, params)).rows;
  const idOf = (key: string) => ctx.users[key].id;
  const keyOf = new Map(Object.entries(ctx.users).map(([k, v]) => [v.id, k]));

  const act = async (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) => {
    const res = await call(who, method, url, body);
    const label = `${who} ${method} ${url.replace(/[0-9a-f-]{36}/g, (m) => m.slice(0, 8))} ${body ? JSON.stringify(body).slice(0, 80) : ''} → ${res.status}`;
    history.push(label);
    if (history.length > 30) history.shift();
    if (res.status >= 500) serverErrors.push(label);
    const kind = url.replace(/[0-9a-f-]{36}/g, ':id').replace(/\?.*$/, '');
    const k = `${method} ${kind} ${res.status < 300 ? 'ok' : 'recusada'}`;
    stats[k] = (stats[k] ?? 0) + 1;
    return res;
  };

  /** Cartões de uma pessoa com o estado da delegação recebida e da delegação para baixo. */
  const cardsOf = async (who: string) =>
    q(
      `SELECT c.id, c.list_id, c.completed_at, c.archived_at, c.is_private, c.transferred_from_id,
              d.id AS d_id, d.status AS d_status,
              (SELECT x.id FROM delegations x WHERE x.parent_card_id = c.id AND x.status NOT IN ('ACKED','CANCELED') LIMIT 1) AS child_open
         FROM cards c LEFT JOIN delegations d ON d.card_id = c.id
        WHERE c.owner_id = $1 AND (d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))`,
      [idOf(who)],
    );
  const reportsOf = (who: string) => PEOPLE.filter((p) => ctx.users[p] && keyOfManager.get(p) === who);
  const keyOfManager = new Map<string, string>();
  for (const row of await q('SELECT id, manager_id FROM users')) {
    const k = keyOf.get(row.id)!;
    if (row.manager_id) keyOfManager.set(k, keyOf.get(row.manager_id)!);
  }

  const actions: Record<string, () => Promise<void>> = {
    async criar() {
      const who = r.pick(PEOPLE);
      const lists = await q(`SELECT l.id FROM lists l JOIN boards b ON b.id = l.board_id WHERE b.owner_id = $1 AND l.archived_at IS NULL`, [idOf(who)]);
      const res = await act(who, 'POST', '/api/cards', { listId: r.pick(lists).id, title: `Tarefa ${r.next().toString(36).slice(2, 7)}` });
      if (res.status === 200 && r.chance(0.5)) await act(who, 'PATCH', `/api/cards/${res.body.id}`, { dueDate: day(Math.floor(r.next() * 30) - 10) });
    },
    async delegar() {
      const who = r.pick(PEOPLE.filter((p) => reportsOf(p).length));
      const cards = (await cardsOf(who)).filter((c) => c.list_id && !c.archived_at && (r.chance(0.9) ? !c.completed_at && !c.child_open : true));
      if (!cards.length) return;
      const to = r.chance(0.9) ? r.pick(reportsOf(who)) : r.pick(PEOPLE); // às vezes, destino errado de propósito
      await act(who, 'POST', `/api/cards/${r.pick(cards).id}/delegate`, { toUserId: idOf(to), ...(r.chance(0.3) ? { suggestedDue: day(5), note: 'Veja isso' } : {}) });
    },
    async aceitar() {
      const who = r.pick(PEOPLE);
      const inbox = (await act(who, 'GET', '/api/inbox')).body;
      if (!inbox.length) return;
      await act(who, 'POST', `/api/cards/${r.pick(inbox as any[]).id}/accept`, { listId: await firstListOf(ctx, who) });
    },
    async devolver() {
      const who = r.pick(PEOPLE);
      const cards = (await cardsOf(who)).filter((c) => c.d_id && !c.archived_at);
      if (!cards.length) return;
      await act(who, 'POST', `/api/cards/${r.pick(cards).id}/decline`, { reason: r.chance(0.8) ? 'Não consigo agora' : '' });
    },
    async concluir() {
      const who = r.pick(PEOPLE);
      const cards = (await cardsOf(who)).filter((c) => !c.archived_at);
      if (!cards.length) return;
      const c = r.pick(cards);
      await act(who, 'POST', `/api/cards/${c.id}/${c.completed_at && r.chance(0.7) ? 'uncomplete' : 'complete'}`);
    },
    async responder() {
      // delegador dá ciente, reabre, cancela ou redelega
      const who = r.pick(PEOPLE.filter((p) => reportsOf(p).length));
      const mine = await q(`SELECT id, status FROM delegations WHERE delegator_id = $1 AND status NOT IN ('ACKED','CANCELED')`, [idOf(who)]);
      if (!mine.length) return;
      const waiting = mine.filter((x) => x.status === 'AWAITING_ACK');
      const d = waiting.length && r.chance(0.7) ? r.pick(waiting) : r.pick(mine);
      const roll = r.next();
      if (d.status === 'AWAITING_ACK' && roll < 0.6) await act(who, 'POST', `/api/delegations/${d.id}/ack`);
      else if (d.status === 'AWAITING_ACK') await act(who, 'POST', `/api/delegations/${d.id}/reopen`, { comment: 'Refazer a parte final' });
      else if (d.status === 'DECLINED' && roll < 0.5) await act(who, 'POST', `/api/delegations/${d.id}/redelegate`, { toUserId: idOf(r.pick(reportsOf(who))) });
      else if (roll < 0.12) await act(who, 'POST', `/api/delegations/${d.id}/cancel`);
      else await act(who, 'POST', `/api/delegations/${d.id}/ack`); // muitas vezes inválido de propósito
    },
    async transferir() {
      const who = r.pick(PEOPLE);
      const cards = (await cardsOf(who)).filter((c) => !c.archived_at);
      if (!cards.length) return;
      const c = r.pick(cards);
      const targets = c.list_id ? (await act(who, 'GET', `/api/cards/${c.id}/transfer-targets`)).body : [];
      const to = Array.isArray(targets) && targets.length && r.chance(0.85) ? r.pick(targets as any[]).id : idOf(r.pick(PEOPLE));
      await act(who, 'POST', `/api/cards/${c.id}/transfer`, { toUserId: to });
    },
    async editar() {
      const who = r.pick(PEOPLE);
      const cards = (await cardsOf(who)).filter((c) => !c.archived_at);
      if (!cards.length) return;
      const c = r.pick(cards);
      const roll = r.next();
      if (roll < 0.25) await act(who, 'PATCH', `/api/cards/${c.id}`, { isPrivate: !c.is_private });
      else if (roll < 0.5) await act(who, 'PATCH', `/api/cards/${c.id}`, { dueDate: r.chance(0.2) ? null : day(Math.floor(r.next() * 20) - 5) });
      else if (roll < 0.7) await act(who, 'POST', `/api/cards/${c.id}/checklist`, { text: 'Passo' });
      else if (roll < 0.85) await act(who, 'POST', `/api/cards/${c.id}/comments`, { body: 'Andamento' });
      else {
        const lists = await q(`SELECT l.id FROM lists l JOIN boards b ON b.id = l.board_id WHERE b.owner_id = $1 AND l.archived_at IS NULL`, [idOf(who)]);
        await act(who, 'POST', `/api/cards/${c.id}/move`, { listId: r.pick(lists).id, ...(r.chance(0.5) ? { place: 'top' } : {}) });
      }
    },
    async arquivar() {
      const who = r.pick(PEOPLE);
      const cards = await q(`SELECT id, archived_at FROM cards WHERE owner_id = $1 AND completed_at IS NOT NULL`, [idOf(who)]);
      if (!cards.length) return;
      const c = r.pick(cards);
      await act(who, 'POST', `/api/cards/${c.id}/${c.archived_at ? 'unarchive' : 'archive'}`);
    },
    async intrometer() {
      // alguém tenta mexer na tarefa de outra pessoa: precisa sempre ser recusado
      const who = r.pick(PEOPLE);
      const other = await q(`SELECT id FROM cards WHERE owner_id <> $1 ORDER BY random() LIMIT 1`, [idOf(who)]);
      if (!other.length) return;
      const res = await act(who, 'PATCH', `/api/cards/${other[0].id}`, { title: 'invadido' });
      if (res.status === 200) {
        const row = (await q(`SELECT c.owner_id, d.status FROM cards c LEFT JOIN delegations d ON d.card_id = c.id WHERE c.id = $1`, [other[0].id]))[0];
        throw new Error(`${who} conseguiu editar a tarefa de ${keyOf.get(row.owner_id)} (${row.status ?? 'própria'})`);
      }
    },
  };
  const weights: [string, number][] = [
    ['criar', 14], ['delegar', 14], ['aceitar', 12], ['devolver', 5], ['concluir', 12], ['responder', 12],
    ['transferir', 6], ['editar', 14], ['arquivar', 5], ['intrometer', 6],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  const pickAction = () => {
    let x = r.next() * total;
    for (const [name, w] of weights) if ((x -= w) < 0) return name;
    return weights[0][0];
  };

  /** Regras que nunca podem ser quebradas, conferidas direto no banco e pela API. */
  const checkInvariants = async (step: number) => {
    const fail = (msg: string, rows?: unknown) => {
      throw new Error(`Semente ${seed}, passo ${step}: ${msg}${rows ? `\n${JSON.stringify(rows, null, 1).slice(0, 1500)}` : ''}\nÚltimas ações:\n${history.join('\n')}`);
    };
    if (serverErrors.length) fail(`erro interno do servidor (500): ${serverErrors.join('; ')}`);

    // 1. Códigos únicos e toda tarefa com exatamente um detentor ativo.
    const dupCodes = await q(`SELECT code FROM cards GROUP BY code HAVING count(*) > 1`);
    if (dupCodes.length) fail('código repetido', dupCodes);
    const orphan = await q(`SELECT c.code FROM cards c LEFT JOIN users u ON u.id = c.owner_id WHERE u.id IS NULL OR NOT u.active`);
    if (orphan.length) fail('tarefa sem detentor ativo', orphan);

    // 2. Estado da delegação coerente com o cartão.
    const incoherent = await q(`
      SELECT c.code, d.status, c.list_id IS NOT NULL AS in_list, c.completed_at IS NOT NULL AS done, c.archived_at IS NOT NULL AS archived
        FROM delegations d JOIN cards c ON c.id = d.card_id
       WHERE (d.status = 'PENDING_ACCEPT' AND (c.list_id IS NOT NULL OR c.archived_at IS NOT NULL OR c.completed_at IS NOT NULL))
          OR (d.status = 'IN_PROGRESS'    AND (c.list_id IS NULL OR c.completed_at IS NOT NULL OR c.archived_at IS NOT NULL))
          OR (d.status = 'AWAITING_ACK'   AND (c.completed_at IS NULL OR c.archived_at IS NOT NULL))
          OR (d.status = 'DECLINED'       AND (c.list_id IS NOT NULL OR c.archived_at IS NOT NULL))
          OR (d.status IN ('ACKED','CANCELED') AND c.archived_at IS NULL)`);
    if (incoherent.length) fail('estado da delegação incoerente com a tarefa', incoherent);

    // 3. No máximo uma delegação ativa por tarefa de origem (RN-17).
    const multi = await q(`SELECT parent_card_id, count(*) FROM delegations WHERE status NOT IN ('ACKED','CANCELED') GROUP BY parent_card_id HAVING count(*) > 1`);
    if (multi.length) fail('mais de uma delegação ativa na mesma tarefa', multi);

    // 4. Tarefa recebida por delegação nunca é privada (RN-08).
    const privDeleg = await q(`SELECT c.code FROM cards c JOIN delegations d ON d.card_id = c.id WHERE c.is_private AND d.status NOT IN ('CANCELED','DECLINED','ACKED')`);
    if (privDeleg.length) fail('tarefa delegada marcada como privada', privDeleg);

    // 5. Tarefa na fase de um quadro que não é do detentor.
    const wrongBoard = await q(`SELECT c.code FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id WHERE b.owner_id <> c.owner_id`);
    if (wrongBoard.length) fail('tarefa no quadro de outra pessoa', wrongBoard);

    // 6. O log só cresce: os eventos antigos continuam idênticos.
    const old = await q(`SELECT md5(coalesce(string_agg(e::text, '|' ORDER BY e.id), '')) AS h FROM (SELECT * FROM card_events ORDER BY id LIMIT $1) e`, [eventsSeen]);
    if (old[0].h !== eventsHash) fail('o log de eventos antigos mudou');
    const all = await q(`SELECT count(*)::int AS n FROM card_events`);
    eventsSeen = all[0].n;
    eventsHash = (await q(`SELECT md5(coalesce(string_agg(e::text, '|' ORDER BY e.id), '')) AS h FROM (SELECT * FROM card_events ORDER BY id LIMIT $1) e`, [eventsSeen]))[0].h;

    // 7. Tarefas privadas não aparecem para mais ninguém, em lugar nenhum.
    const privs = await q(`SELECT id, code, owner_id, title FROM cards WHERE is_private`);
    for (const p of privs.slice(0, 5)) {
      for (const who of PEOPLE.filter((x) => idOf(x) !== p.owner_id)) {
        const res = await call(who, 'GET', `/api/cards/${p.id}`);
        if (res.status !== 404) fail(`${who} vê a tarefa privada ${p.code} (status ${res.status})`);
      }
    }
    const privCodes = new Set(privs.map((p) => p.code));

    for (const who of PEOPLE) {
      const me = (await call(who, 'GET', '/api/me')).body;
      const inbox = (await call(who, 'GET', '/api/inbox')).body;
      // 8. Contador da caixa de entrada bate com a lista.
      if (me.counts.inbox !== inbox.length) fail(`contador da caixa de entrada de ${who} (${me.counts.inbox}) ≠ itens (${inbox.length})`);
      if (!me.directReports.length) continue;
      const ov = (await call(who, 'GET', '/api/delegations')).body;
      const dash = (await call(who, 'GET', '/api/dashboard')).body;
      const seen = JSON.stringify([ov, dash]);
      for (const c of privCodes) {
        const owner = privs.find((p) => p.code === c)!.owner_id;
        if (owner !== idOf(who) && seen.includes(`"${c}"`)) fail(`tarefa privada ${c} aparece para ${who} em Delegadas/Painel`);
      }
      // 9. Contadores de "Tarefas delegadas" e do Painel batem com o banco.
      for (const g of ov.groups) {
        const real = (await q(
          `SELECT
             count(*) FILTER (WHERE d.status IN ('PENDING_ACCEPT','IN_PROGRESS'))::int AS open,
             count(*) FILTER (WHERE d.status = 'AWAITING_ACK')::int AS awaiting,
             count(*) FILTER (WHERE d.status = 'DECLINED')::int AS declined
           FROM delegations d JOIN cards c ON c.id = d.card_id
          WHERE d.delegator_id = $1 AND c.owner_id = $2 AND c.archived_at IS NULL`,
          [idOf(who), g.person.id],
        ))[0];
        const own = (await q(
          `SELECT count(*)::int AS n FROM cards c LEFT JOIN delegations d ON d.card_id = c.id
            WHERE c.owner_id = $1 AND d.id IS NULL AND c.archived_at IS NULL AND c.completed_at IS NULL AND NOT c.is_private`,
          [g.person.id],
        ))[0].n;
        const got = { open: g.counts.open, awaiting: g.counts.awaitingAck, declined: g.counts.declined, own: g.counts.own };
        const want = { open: real.open, awaiting: real.awaiting, declined: real.declined, own };
        if (JSON.stringify(got) !== JSON.stringify(want)) fail(`contadores de ${who} para ${keyOf.get(g.person.id)}: tela ${JSON.stringify(got)} ≠ banco ${JSON.stringify(want)}`);
      }
      const sum = ov.groups.reduce((s: any, g: any) => ({ open: s.open + g.counts.open, awaiting: s.awaiting + g.counts.awaitingAck, declined: s.declined + g.counts.declined }), { open: 0, awaiting: 0, declined: 0 });
      const ds = dash.summary;
      if (ds.open !== sum.open || ds.awaitingAck !== sum.awaiting || ds.declined !== sum.declined) {
        fail(`resumo do Painel de ${who} ${JSON.stringify(ds)} ≠ Tarefas delegadas ${JSON.stringify(sum)}`);
      }
      if (me.counts.needAction !== sum.awaiting + sum.declined) fail(`contador "precisa de ação" de ${who} (${me.counts.needAction}) ≠ ${sum.awaiting + sum.declined}`);
    }
  };

  try {
    await checkInvariants(0);
    for (let step = 1; step <= STEPS; step++) {
      await actions[pickAction()]();
      if (step % CHECK_EVERY === 0 || step === STEPS) await checkInvariants(step);
    }
    const counts = (await q(`SELECT status, count(*)::int AS n FROM delegations GROUP BY status ORDER BY status`)).map((x) => `${x.status}=${x.n}`);
    return { stats, counts };
  } finally {
    await ctx.app.close();
    await ctx.pool.end();
  }
}

describe('uso caótico (frente 4)', () => {
  for (const seed of SEEDS) {
    it(`semente ${seed}: ${STEPS} ações sorteadas sem quebrar nenhuma regra`, async () => {
      const { stats, counts } = await runChaos(seed);
      const ok = Object.entries(stats).filter(([k]) => k.endsWith(' ok')).reduce((s, [, n]) => s + n, 0);
      // O sorteio precisa exercitar o fluxo de verdade, não só tentativas recusadas.
      expect(ok).toBeGreaterThan(STEPS / 4);
      expect(counts.join(' ')).toMatch(/ACKED=\d+/);
      if (process.env.CHAOS_VERBOSE) console.log(`semente ${seed}`, counts, stats);
    }, 600_000);
  }
});
