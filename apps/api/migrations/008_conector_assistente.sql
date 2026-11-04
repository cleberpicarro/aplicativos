-- Item 65: conector para assistentes de IA (Claude e outros compatíveis com MCP).
-- O assistente pede acesso pelo OAuth: a pessoa entra no SyncTasks e clica em "Permitir".
-- Daí em diante o assistente age em nome dela, com as mesmas regras dos botões do app.

-- Assistentes que se cadastraram sozinhos (cadastro dinâmico do OAuth). Não dão acesso a nada sem o "Permitir".
CREATE TABLE oauth_clients (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Código de uso único entregue depois do "Permitir"; vale 10 minutos e é trocado pelas chaves de acesso.
CREATE TABLE oauth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id),
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);

-- Uma ligação por "Permitir". Guarda só o resumo (hash) das chaves; a chave de acesso dura 1 hora
-- e a de renovação 60 dias, e as duas mudam a cada renovação. "Desligar" em Meus dados corta na hora.
CREATE TABLE oauth_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  client_id          text NOT NULL REFERENCES oauth_clients(id),
  access_hash        text UNIQUE,
  access_expires_at  timestamptz,
  refresh_hash       text UNIQUE,
  refresh_expires_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);
CREATE INDEX oauth_grants_user ON oauth_grants (user_id) WHERE revoked_at IS NULL;
