-- Item 41: o delegador pode marcar que a tarefa delegada não pode ser repassada (nem delegada para baixo nem
-- transferida para um subordinado). A marca fica na delegação e acompanha o cartão de quem recebeu.
ALTER TABLE delegations ADD COLUMN no_pass boolean NOT NULL DEFAULT false;

-- Item 43: tarefa que tem ou teve delegação (recebida ou delegada para alguém, menos a cancelada) não pode ser privada.
-- As que já estão privadas viram visíveis, com o registro no log de cada uma.
WITH fixed AS (
  UPDATE cards c SET is_private = false, updated_at = now()
   WHERE c.is_private
     AND (EXISTS (SELECT 1 FROM delegations d WHERE d.card_id = c.id)
          OR EXISTS (SELECT 1 FROM delegations d WHERE d.parent_card_id = c.id AND d.status <> 'CANCELED'))
  RETURNING c.id
)
INSERT INTO card_events (card_id, actor_id, type, before, after)
SELECT id, NULL, 'privacy_changed', '{"isPrivate": true}'::jsonb, '{"isPrivate": false, "reason": "delegated"}'::jsonb FROM fixed;
