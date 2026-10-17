-- Item 46: e-mails de prazo (véspera e vencido) e resumo diário.
-- Em "Meus dados", cada pessoa pode desligar cada tipo; ligados por padrão.
ALTER TABLE users ADD COLUMN email_digest boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN email_due boolean NOT NULL DEFAULT true;
-- Dia (em Brasília) em que o último resumo diário foi preparado para a pessoa: um por dia, no máximo.
ALTER TABLE users ADD COLUMN digest_sent_on date;
-- Para qual prazo o aviso da véspera e o de vencido já saíram. Se o prazo mudar, a data deixa de bater e o aviso sai de novo.
ALTER TABLE cards ADD COLUMN due_eve_sent_for date;
ALTER TABLE cards ADD COLUMN due_late_sent_for date;
CREATE INDEX cards_due_open ON cards (due_date) WHERE completed_at IS NULL AND archived_at IS NULL;

-- Item 48: "Desfazer" do cancelamento de uma delegação. Guarda onde a tarefa estava (situação, fase e posição)
-- para devolvê-la ao mesmo lugar, com o mesmo número.
ALTER TABLE delegations ADD COLUMN cancel_prev_status text;
ALTER TABLE delegations ADD COLUMN cancel_prev_list_id uuid REFERENCES lists(id);
ALTER TABLE delegations ADD COLUMN cancel_prev_position double precision;
