-- Item 72: substituição em férias e ausências. Quem sai escolhe um substituto, que passa a ver e gerenciar
-- os quadros, a caixa de entrada e as delegações da pessoa (nunca as privadas; as comuns só se ela compartilhar).
CREATE TABLE substitutions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absent_id     uuid NOT NULL REFERENCES users(id),
  substitute_id uuid NOT NULL REFERENCES users(id),
  share_common  boolean NOT NULL DEFAULT false,
  -- Último dia da ausência (dia de Brasília); NULL = até alguém encerrar.
  ends_on       date,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  ended_by      uuid REFERENCES users(id),
  CHECK (absent_id <> substitute_id)
);
-- Uma substituição em aberto por pessoa ausente.
CREATE UNIQUE INDEX substitutions_open ON substitutions (absent_id) WHERE ended_at IS NULL;
CREATE INDEX substitutions_substitute ON substitutions (substitute_id) WHERE ended_at IS NULL;

-- Quem fez de verdade, quando o substituto age em nome da pessoa: o app grava o substituto na transação
-- (set_config('synctasks.via', ...)) e estas colunas o pegam sozinhas.
ALTER TABLE cards ADD COLUMN created_via uuid REFERENCES users(id) DEFAULT nullif(current_setting('synctasks.via', true), '')::uuid;
ALTER TABLE card_events ADD COLUMN via_user_id uuid REFERENCES users(id) DEFAULT nullif(current_setting('synctasks.via', true), '')::uuid;
ALTER TABLE comments ADD COLUMN via_user_id uuid REFERENCES users(id) DEFAULT nullif(current_setting('synctasks.via', true), '')::uuid;
