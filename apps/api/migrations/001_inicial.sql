-- Nerus Tasks: esquema inicial

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text,
  -- 0 CEO, 1 Diretor, 2 Gestor, 3 Funcionário; NULL = fora da hierarquia (administrador puro)
  level         smallint CHECK (level BETWEEN 0 AND 3),
  role_title    text NOT NULL,
  manager_id    uuid REFERENCES users(id),
  is_admin      boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
CREATE INDEX users_manager ON users (manager_id);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE password_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE manager_changes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id),
  from_manager_id        uuid REFERENCES users(id),
  to_manager_id          uuid NOT NULL REFERENCES users(id),
  admin_id               uuid NOT NULL REFERENCES users(id),
  moved_open_delegations integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE boards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id),
  name        text NOT NULL,
  position    double precision NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boards_owner ON boards (owner_id);

CREATE TABLE lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    uuid NOT NULL REFERENCES boards(id),
  name        text NOT NULL,
  position    double precision NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lists_board ON lists (board_id, position);

-- Código legível da tarefa: NT- seguido de no mínimo 6 dígitos, sem teto e nunca reutilizado.
CREATE SEQUENCE card_code_seq START 1;

CREATE TABLE cards (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint NOT NULL UNIQUE DEFAULT nextval('card_code_seq'),
  code                text GENERATED ALWAYS AS (
                        'NT-' || CASE WHEN seq < 1000000 THEN lpad(seq::text, 6, '0') ELSE seq::text END
                      ) STORED,
  owner_id            uuid NOT NULL REFERENCES users(id),
  list_id             uuid REFERENCES lists(id),          -- NULL = caixa de entrada (ou fora de quadro)
  position            double precision NOT NULL DEFAULT 0,
  title               varchar(200) NOT NULL,
  description         text NOT NULL DEFAULT '',
  due_date            date,
  is_private          boolean NOT NULL DEFAULT false,
  completed_at        timestamptz,
  archived_at         timestamptz,
  transferred_from_id uuid REFERENCES users(id),
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  search              tsvector GENERATED ALWAYS AS (
                        to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, ''))
                      ) STORED
);
ALTER SEQUENCE card_code_seq OWNED BY cards.seq;
CREATE UNIQUE INDEX cards_code ON cards (code);
CREATE INDEX cards_owner ON cards (owner_id, archived_at);
CREATE INDEX cards_list ON cards (list_id, position);
CREATE INDEX cards_search ON cards USING gin (search);

CREATE TABLE delegations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        uuid NOT NULL UNIQUE REFERENCES cards(id),   -- cartão de quem recebeu
  parent_card_id uuid REFERENCES cards(id),                   -- cartão de quem delegou
  delegator_id   uuid NOT NULL REFERENCES users(id),
  status         text NOT NULL CHECK (status IN ('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK','DECLINED','ACKED','CANCELED')),
  reopened       boolean NOT NULL DEFAULT false,
  decline_reason text,
  suggested_due  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  acked_at       timestamptz,
  canceled_at    timestamptz
);
CREATE INDEX delegations_delegator ON delegations (delegator_id, status);
CREATE INDEX delegations_parent ON delegations (parent_card_id);

CREATE TABLE checklist_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id    uuid NOT NULL REFERENCES cards(id),
  text       varchar(300) NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  position   double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklist_card ON checklist_items (card_id, position);

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id    uuid NOT NULL REFERENCES cards(id),
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_card ON comments (card_id, created_at);

-- Log da tarefa: somente inserção.
CREATE TABLE card_events (
  id         bigserial PRIMARY KEY,
  card_id    uuid NOT NULL REFERENCES cards(id),
  actor_id   uuid REFERENCES users(id),
  type       text NOT NULL,
  before     jsonb,
  after      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_events_card ON card_events (card_id, created_at);

CREATE FUNCTION nerus_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% é somente inserção: registros não podem ser alterados nem apagados', TG_TABLE_NAME;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER card_events_immutable BEFORE UPDATE OR DELETE ON card_events
  FOR EACH ROW EXECUTE FUNCTION nerus_forbid_change();
CREATE TRIGGER comments_immutable BEFORE UPDATE OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION nerus_forbid_change();

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  card_id    uuid REFERENCES cards(id),
  type       text NOT NULL,
  text       text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE email_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);
CREATE INDEX email_outbox_pending ON email_outbox (status, created_at);
