import { createHash } from 'node:crypto';
import { z } from 'zod';
import { one, many, type Db } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { newToken, sha256 } from '../lib/passwords.js';
import { toActor, type Actor } from './actors.js';

/**
 * Item 65: OAuth 2.1 do conector para assistentes de IA (MCP).
 * O assistente se cadastra sozinho, manda a pessoa para a tela "Permitir" do SyncTasks
 * e troca o código recebido por uma chave de acesso que vale só para as ações do conector.
 */

export const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 60;
const CODE_MINUTES = 10;

/** Erro no formato do OAuth ({ error, error_description }). */
export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** Endereço de volta aceito: https, ou http só no próprio computador (assistentes instalados, como o Claude Code). */
export function validRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

const registerSchema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().max(200).optional(),
});

/** Cadastro dinâmico (RFC 7591). Sem o "Permitir" de alguém, o cadastro não dá acesso a nada. */
export async function registerClient(db: Db, body: unknown) {
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) throw new OAuthError('invalid_client_metadata', 'Informe redirect_uris.');
  const uris = parsed.data.redirect_uris;
  if (!uris.every(validRedirect)) throw new OAuthError('invalid_redirect_uri', 'O endereço de volta precisa ser https (ou http no próprio computador).');
  const name = (parsed.data.client_name ?? '').trim().slice(0, 80) || 'Assistente';
  // Faxina: cadastros com mais de 7 dias que nunca foram permitidos por ninguém.
  await db.query(
    `DELETE FROM oauth_clients c WHERE c.created_at < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.id)`,
  );
  const id = `stc_${newToken()}`;
  const row = await one(db, 'INSERT INTO oauth_clients (id, name, redirect_uris) VALUES ($1, $2, $3) RETURNING created_at', [id, name, uris]);
  return {
    client_id: id,
    client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

export const authorizeSchema = z.object({
  response_type: z.string().max(40).optional(),
  client_id: z.string().max(200),
  redirect_uri: z.string().max(2000),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  state: z.string().max(2000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(2000).optional(),
});
export type AuthorizeParams = z.infer<typeof authorizeSchema>;

/**
 * Confere o pedido de acesso. Cliente ou endereço de volta errados não voltam ao assistente
 * (seria mandar alguém para um endereço desconhecido): viram mensagem na tela.
 */
export async function checkAuthorize(db: Db, p: AuthorizeParams) {
  const client = await one(db, 'SELECT * FROM oauth_clients WHERE id = $1', [p.client_id]);
  if (!client) throw notFound('Este assistente não está cadastrado. Tente conectar de novo pelo assistente.');
  if (!client.redirect_uris.includes(p.redirect_uri)) throw forbidden('O endereço de volta não confere com o cadastro do assistente.');
  const problem =
    p.response_type !== 'code' ? 'unsupported_response_type'
    : !p.code_challenge || p.code_challenge_method !== 'S256' ? 'invalid_request'
    : null;
  return { client: { id: client.id as string, name: client.name as string, host: new URL(p.redirect_uri).host }, problem };
}

/** Endereço de volta ao assistente, com o código ou com o erro. */
function back(redirectUri: string, params: Record<string, string | undefined>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** O "Permitir" (ou "Agora não") da tela do SyncTasks. Devolve o endereço para onde o navegador segue. */
export async function decide(db: Db, actor: Actor, p: AuthorizeParams, allow: boolean) {
  const { client, problem } = await checkAuthorize(db, p);
  if (problem) return { redirect: back(p.redirect_uri, { error: problem, state: p.state }) };
  if (!allow) return { redirect: back(p.redirect_uri, { error: 'access_denied', state: p.state }) };
  if (actor.level === null) throw forbidden('Administradores fora da hierarquia não têm quadros nem tarefas para o assistente.');
  const code = newToken();
  await db.query(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [sha256(code), client.id, actor.id, p.redirect_uri, p.code_challenge, String(CODE_MINUTES)],
  );
  return { redirect: back(p.redirect_uri, { code, state: p.state }) };
}

function pkce(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function issue(db: Db, grantId: string) {
  const access = `sta_${newToken()}`;
  const refresh = `str_${newToken()}`;
  await db.query(
    `UPDATE oauth_grants SET access_hash = $2, access_expires_at = now() + ($4 || ' seconds')::interval,
            refresh_hash = $3, refresh_expires_at = now() + ($5 || ' days')::interval
      WHERE id = $1`,
    [grantId, sha256(access), sha256(refresh), String(ACCESS_SECONDS), String(REFRESH_DAYS)],
  );
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: 'tarefas' };
}

/** Rota /oauth/token: troca o código (com PKCE) ou renova as chaves (a de renovação também muda). */
export async function token(db: Db, body: Record<string, string | undefined>) {
  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.code_verifier || !body.redirect_uri) throw new OAuthError('invalid_request', 'Faltam code, code_verifier ou redirect_uri.');
    const c = await one(db, 'SELECT * FROM oauth_codes WHERE code_hash = $1 FOR UPDATE', [sha256(body.code)]);
    if (!c || c.used_at || new Date(c.expires_at) < new Date()) throw new OAuthError('invalid_grant', 'Código inválido, expirado ou já usado.');
    await db.query('UPDATE oauth_codes SET used_at = now() WHERE code_hash = $1', [c.code_hash]);
    if ((body.client_id && body.client_id !== c.client_id) || body.redirect_uri !== c.redirect_uri || pkce(body.code_verifier) !== c.code_challenge) {
      throw new OAuthError('invalid_grant', 'O código não confere.');
    }
    const user = await one(db, 'SELECT id FROM users WHERE id = $1 AND active', [c.user_id]);
    if (!user) throw new OAuthError('invalid_grant', 'Pessoa desativada.');
    const g = await one(db, 'INSERT INTO oauth_grants (user_id, client_id) VALUES ($1, $2) RETURNING id', [c.user_id, c.client_id]);
    return issue(db, g.id);
  }
  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) throw new OAuthError('invalid_request', 'Falta refresh_token.');
    const g = await one(
      db,
      `SELECT g.* FROM oauth_grants g JOIN users u ON u.id = g.user_id
        WHERE g.refresh_hash = $1 AND g.revoked_at IS NULL AND g.refresh_expires_at > now() AND u.active FOR UPDATE OF g`,
      [sha256(body.refresh_token)],
    );
    if (!g || (body.client_id && body.client_id !== g.client_id)) throw new OAuthError('invalid_grant', 'Chave de renovação inválida ou desligada.');
    return issue(db, g.id);
  }
  throw new OAuthError('unsupported_grant_type', 'Use authorization_code ou refresh_token.');
}

/** Quem está por trás da chave de acesso (Authorization: Bearer). Ligação desligada ou pessoa desativada: ninguém. */
export async function actorFromAccessToken(db: Db, header: string | undefined): Promise<Actor | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m) return null;
  const row = await one(
    db,
    `SELECT u.*, g.id AS grant_id, g.last_used_at AS grant_used FROM oauth_grants g JOIN users u ON u.id = g.user_id
      WHERE g.access_hash = $1 AND g.revoked_at IS NULL AND g.access_expires_at > now() AND u.active`,
    [sha256(m[1])],
  );
  if (!row) return null;
  if (!row.grant_used || Date.now() - new Date(row.grant_used).getTime() > 60_000) {
    await db.query('UPDATE oauth_grants SET last_used_at = now() WHERE id = $1', [row.grant_id]);
  }
  return toActor(row);
}

/** Meus dados: os assistentes ligados à conta da pessoa. */
export async function listGrants(db: Db, actor: Actor) {
  const rows = await many(
    db,
    `SELECT g.id, c.name, c.redirect_uris[1] AS uri, g.created_at, g.last_used_at
       FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
      WHERE g.user_id = $1 AND g.revoked_at IS NULL AND g.refresh_expires_at > now()
      ORDER BY g.created_at DESC`,
    [actor.id],
  );
  return rows.map((r) => {
    let host = '';
    try { host = new URL(r.uri).host; } catch { /* endereço já validado no cadastro */ }
    return { id: r.id as string, name: r.name as string, host, createdAt: r.created_at, lastUsedAt: r.last_used_at };
  });
}

/** "Desligar": a chave para de funcionar na hora. Só a própria pessoa desliga as dela. */
export async function revokeGrant(db: Db, actor: Actor, id: string) {
  const r = await db.query('UPDATE oauth_grants SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [id, actor.id]);
  if (!r.rowCount) throw notFound('Ligação não encontrada.');
}
