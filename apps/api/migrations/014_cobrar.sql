-- Item 90: botão "Cobrar" na tarefa delegada. Guarda a última cobrança (quando, quantas vezes e o recado).
ALTER TABLE delegations
  ADD COLUMN nudged_at timestamptz,
  ADD COLUMN nudge_count integer NOT NULL DEFAULT 0,
  ADD COLUMN nudge_message text;
