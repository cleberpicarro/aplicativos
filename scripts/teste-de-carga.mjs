/**
 * Teste de carga (frente 5 do plano de testes): simula a empresa inteira usando o SyncTasks ao mesmo tempo.
 *
 * Roda numa CÓPIA LOCAL, nunca no site publicado: cria um banco próprio (nerus_carga), cadastra
 * ~100 pessoas numa hierarquia parecida com a da Nerus e liga o servidor nesta máquina.
 * Cada pessoa virtual repete o que se faz no dia a dia: abre o quadro, a caixa de entrada, cria tarefa,
 * muda prazo, conclui, busca, delega e (quem tem equipe) olha o Painel e as Tarefas delegadas.
 *
 * Uso:  npm run build  e depois  npm run test:carga
 * Opções (variáveis de ambiente): CARGA_PESSOAS=100  CARGA_SEGUNDOS=60  CARGA_LIMITE_MS=800
 * Termina com erro se alguma resposta falhar ou se 95% das respostas não vierem abaixo do limite.
 */
import { createPool, tx } from '../apps/api/dist/src/lib/db.js';
import { migrate } from '../apps/api/dist/src/lib/migrate.js';
import { buildApp } from '../apps/api/dist/src/app.js';
import { hashPassword } from '../apps/api/dist/src/lib/passwords.js';
import { createUser } from '../apps/api/dist/src/services/admin.js';
import pg from 'pg';

const PESSOAS = Number(process.env.CARGA_PESSOAS ?? 100);
const SEGUNDOS = Number(process.env.CARGA_SEGUNDOS ?? 60);
const LIMITE_MS = Number(process.env.CARGA_LIMITE_MS ?? 800);
const PORTA = Number(process.env.CARGA_PORTA ?? 3200);
const URL_BANCO = process.env.CARGA_DATABASE_URL ?? 'postgres://nerus:nerus@localhost:5432/nerus_carga';
const SENHA = 'carga-2026';

/* ---------- banco limpo ---------- */
const nomeBanco = new URL(URL_BANCO).pathname.slice(1);
const adm = new pg.Client({ connectionString: URL_BANCO.replace(/\/[^/]+$/, '/postgres') });
await adm.connect();
if (!(await adm.query('SELECT 1 FROM pg_database WHERE datname = $1', [nomeBanco])).rowCount) await adm.query(`CREATE DATABASE "${nomeBanco}"`);
await adm.end();

const pool = createPool(URL_BANCO);
await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate(pool);

/* ---------- equipe: 1 CEO, 5 diretores, 3 gestores por diretor, o resto funcionários ---------- */
console.log(`Cadastrando ${PESSOAS} pessoas…`);
const hash = await hashPassword(SENHA);
const pessoas = []; // { email, nivel, chefe }
await tx(pool, async (db) => {
  const criar = async (nome, nivel, chefe) => {
    const email = `${nome}@carga.teste`;
    const { user } = await createUser(db, { name: `Pessoa ${nome}`, email, level: nivel, managerId: chefe?.id ?? null });
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
    const p = { id: user.id, email, nivel, chefe, equipe: [] };
    chefe?.equipe.push(p);
    pessoas.push(p);
    return p;
  };
  const ceo = await criar('ceo', 0, null);
  const diretores = [];
  for (let i = 1; i <= 5; i++) diretores.push(await criar(`dir${i}`, 1, ceo));
  const gestores = [];
  for (const d of diretores) for (let i = 1; i <= 3; i++) gestores.push(await criar(`${d.email.split('@')[0]}g${i}`, 2, d));
  for (let i = 0; pessoas.length < PESSOAS; i++) await criar(`func${i + 1}`, 3, gestores[i % gestores.length]);
  await db.query('DELETE FROM email_outbox');
});

const app = await buildApp({ pool });
await app.listen({ port: PORTA, host: '127.0.0.1' });
const base = `http://127.0.0.1:${PORTA}`;

/* ---------- medição ---------- */
const tempos = new Map(); // rota → [ms]
const falhas = [];
async function req(p, metodo, caminho, corpo) {
  const t0 = performance.now();
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { cookie: p.cookie ?? '', 'x-synctasks': '1', ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const ms = performance.now() - t0;
  const rota = `${metodo} ${caminho.replace(/[0-9a-f-]{36}/g, ':id').replace(/\?.*$/, '')}`;
  if (!tempos.has(rota)) tempos.set(rota, []);
  tempos.get(rota).push(ms);
  const texto = await r.text();
  if (r.status >= 500 || (r.status >= 400 && !p.esperaRecusa)) falhas.push(`${rota} → ${r.status} ${texto.slice(0, 120)}`);
  if (metodo === 'POST' && caminho === '/api/auth/login') p.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  try { return JSON.parse(texto); } catch { return texto; }
}

const sorteio = (xs) => xs[Math.floor(Math.random() * xs.length)];
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const dia = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** O que uma pessoa faz, em ciclos, até o tempo acabar. */
async function rotina(p, fim) {
  await req(p, 'POST', '/api/auth/login', { email: p.email, password: SENHA });
  const quadros = await req(p, 'GET', '/api/boards');
  const quadro = await req(p, 'GET', `/api/boards/${quadros[0].id}`);
  const fases = quadro.lists.map((l) => l.id);
  while (Date.now() < fim) {
    await req(p, 'GET', '/api/me');
    await req(p, 'GET', `/api/boards/${quadros[0].id}`);
    const caixa = await req(p, 'GET', '/api/inbox');
    for (const c of caixa.slice(0, 2)) await req(p, 'POST', `/api/cards/${c.id}/accept`, { listId: fases[0] });
    const nova = await req(p, 'POST', '/api/cards', { listId: sorteio(fases), title: `Tarefa de carga ${Math.random().toString(36).slice(2, 8)}` });
    await req(p, 'PATCH', `/api/cards/${nova.id}`, { dueDate: dia(Math.floor(Math.random() * 20)), description: 'Detalhes da tarefa' });
    await req(p, 'GET', `/api/cards/${nova.id}`);
    if (p.equipe.length && Math.random() < 0.6) {
      await req(p, 'POST', `/api/cards/${nova.id}/delegate`, { toUserId: sorteio(p.equipe).id, note: 'Pode cuidar disso?' });
      await req(p, 'GET', '/api/delegations');
      await req(p, 'GET', '/api/dashboard');
      const ov = await req(p, 'GET', '/api/delegations');
      for (const c of ov.needAction.filter((x) => x.delegation.status === 'AWAITING_ACK').slice(0, 2)) {
        await req(p, 'POST', `/api/delegations/${c.delegation.id}/ack`);
      }
    } else {
      await req(p, 'POST', `/api/cards/${nova.id}/complete`);
    }
    // conclui uma tarefa recebida que já está no quadro
    const atual = await req(p, 'GET', `/api/boards/${quadros[0].id}`);
    const recebida = atual.cards.find((c) => c.delegation?.status === 'IN_PROGRESS' && !c.completedAt);
    if (recebida) await req(p, 'POST', `/api/cards/${recebida.id}/complete`);
    await req(p, 'GET', `/api/search?q=${encodeURIComponent('carga')}`);
    await req(p, 'GET', '/api/notifications');
    await pausa(1000 + Math.random() * 3000); // tempo de leitura entre uma ação e outra
  }
}

console.log(`Simulando ${PESSOAS} pessoas usando o app ao mesmo tempo por ${SEGUNDOS} segundos…`);
const fim = Date.now() + SEGUNDOS * 1000;
await Promise.all(pessoas.map(async (p, i) => {
  await pausa((i / pessoas.length) * 5000); // chegam aos poucos nos primeiros 5 segundos
  await rotina(p, fim);
}));

/* ---------- relatório ---------- */
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const todos = [...tempos.values()].flat();
const linhas = [...tempos.entries()]
  .map(([rota, xs]) => ({ rota, n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: Math.max(...xs) }))
  .sort((a, b) => b.p95 - a.p95);
console.log('\nTempo de resposta por ação (em milissegundos; p95 = 95% das respostas vieram abaixo disso):');
console.table(linhas.map((l) => ({ ação: l.rota, vezes: l.n, mediana: Math.round(l.p50), p95: Math.round(l.p95), máximo: Math.round(l.max) })));
const p95 = pct(todos, 0.95);
const porSegundo = todos.length / SEGUNDOS;
console.log(`Total: ${todos.length} respostas (${porSegundo.toFixed(1)} por segundo). Mediana ${Math.round(pct(todos, 0.5))} ms, p95 ${Math.round(p95)} ms. Falhas: ${falhas.length}.`);

await app.close();
await pool.end();

let ok = true;
if (falhas.length) {
  ok = false;
  console.log('\n❌ Respostas com erro (primeiras 10):\n' + falhas.slice(0, 10).join('\n'));
}
if (p95 > LIMITE_MS) {
  ok = false;
  console.log(`\n❌ Lento: 95% das respostas deveriam vir abaixo de ${LIMITE_MS} ms, mas o p95 foi ${Math.round(p95)} ms.`);
}
console.log(ok ? `\n✅ Aguentou ${PESSOAS} pessoas ao mesmo tempo, sem erros e com p95 abaixo de ${LIMITE_MS} ms.` : '');
process.exit(ok ? 0 : 1);
