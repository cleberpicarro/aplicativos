-- F6 da revisão geral (item 119): avisos no celular e no computador pelas notificações do navegador (Web Push).
-- Cada aparelho que ligou os avisos guarda aqui o endereço de entrega dado pelo navegador.
CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  failures    integer NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
-- Quando o aviso já foi entregue (ou descartado) para os aparelhos da pessoa.
ALTER TABLE notifications ADD COLUMN pushed_at timestamptz;
UPDATE notifications SET pushed_at = created_at;
CREATE INDEX notifications_to_push ON notifications (created_at) WHERE pushed_at IS NULL;
