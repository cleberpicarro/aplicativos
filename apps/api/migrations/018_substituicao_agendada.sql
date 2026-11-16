-- Item 76: substituição agendada. A substituição pode começar num dia marcado (primeiro dia fora); até lá fica
-- "agendada" e o substituto ainda não troca para a pessoa. NULL = começou ao ser criada (como no item 72).
ALTER TABLE substitutions ADD COLUMN starts_on date;
-- Quando o aviso de "começou hoje" foi para o substituto e para quem saiu (as imediatas já nascem avisadas).
ALTER TABLE substitutions ADD COLUMN start_notified_at timestamptz;
UPDATE substitutions SET start_notified_at = created_at;
ALTER TABLE substitutions ADD CONSTRAINT substitutions_dates CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on);
