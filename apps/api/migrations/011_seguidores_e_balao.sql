-- Item 80: balão na tela quando chega tarefa delegada ou transferida. popped_at marca o aviso que já apareceu
-- como balão (some sozinho e não volta). Os avisos que já existem não viram balão.
ALTER TABLE notifications ADD COLUMN popped_at timestamptz;
UPDATE notifications SET popped_at = now();

-- Item 81: seguidores da tarefa (só e-mails @nerus.com.br). Recebem por e-mail cada novidade do log da tarefa,
-- com o log completo. last_event_id é o último registro do log já enviado; token é o link "parar de seguir".
CREATE TABLE card_followers (
  card_id       uuid NOT NULL REFERENCES cards(id),
  email         text NOT NULL,
  added_by      uuid NOT NULL REFERENCES users(id),
  token         uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  last_event_id bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, email)
);
