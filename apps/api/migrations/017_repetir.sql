-- Item 103 (revisão geral, F1): tarefas que se repetem. Ao concluir, o app cria a próxima com o próximo prazo.
--   uteis   = todo dia útil (segunda a sexta)
--   semanal = toda semana, no dia repeat_n (1 = segunda ... 7 = domingo)
--   mensal  = todo mês, no dia repeat_n (1 a 31; em mês mais curto, o último dia)
--   dias    = a cada repeat_n dias (1 a 365)
ALTER TABLE cards ADD COLUMN repeat_kind text CHECK (repeat_kind IN ('uteis', 'semanal', 'mensal', 'dias'));
ALTER TABLE cards ADD COLUMN repeat_n integer;
ALTER TABLE cards ADD CONSTRAINT cards_repeat_ok CHECK (
  (repeat_kind IS NULL AND repeat_n IS NULL)
  OR (repeat_kind = 'uteis' AND repeat_n IS NULL)
  OR (repeat_kind = 'semanal' AND repeat_n BETWEEN 1 AND 7)
  OR (repeat_kind = 'mensal' AND repeat_n BETWEEN 1 AND 31)
  OR (repeat_kind = 'dias' AND repeat_n BETWEEN 1 AND 365)
);
-- A tarefa que nasceu da repetição desta (para desfazer a conclusão e para o log).
ALTER TABLE cards ADD COLUMN repeat_next_id uuid REFERENCES cards(id);
