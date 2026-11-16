-- Itens 100 e 101 (revisão geral, R5 e R8): alerta de problemas para a administração e faxina diária do banco.
-- Erros inesperados do servidor ficam guardados por 90 dias, para o aviso diário e a tela Configurações.
CREATE TABLE app_problems (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL DEFAULT 'erro' CHECK (kind IN ('erro')),
  detail     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_problems_created ON app_problems (created_at);

-- Até quando os problemas já foram avisados por e-mail, e o dia da última faxina.
ALTER TABLE app_settings ADD COLUMN problems_reported_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app_settings ADD COLUMN health_report_on date;
ALTER TABLE app_settings ADD COLUMN cleanup_on date;

-- A faxina procura por estas colunas.
CREATE INDEX sessions_expires ON sessions (expires_at);
CREATE INDEX notifications_read ON notifications (read_at) WHERE read_at IS NOT NULL;
CREATE INDEX email_outbox_sent ON email_outbox (sent_at) WHERE status = 'sent';
