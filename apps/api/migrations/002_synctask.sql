-- SyncTask: cor do quadro, origem da tarefa e novo prefixo do código.

-- Item 12: cor de fundo por quadro (nome de uma cor da paleta; NULL = padrão).
ALTER TABLE boards ADD COLUMN color text;

-- Item 14: origem da tarefa ('web' = capturada do navegador, 'trello' = importada).
ALTER TABLE cards ADD COLUMN source text;
UPDATE cards c SET source = 'trello'
  WHERE EXISTS (SELECT 1 FROM card_events e WHERE e.card_id = c.id AND e.type = 'imported');

-- Item 13: o app passa a se chamar SyncTask e o código muda de NT- para ST-.
-- O número de cada tarefa não muda; os links antigos com NT- continuam funcionando (a busca aceita os dois).
DROP INDEX cards_code;
ALTER TABLE cards DROP COLUMN code;
ALTER TABLE cards ADD COLUMN code text GENERATED ALWAYS AS (
  'ST-' || CASE WHEN seq < 1000000 THEN lpad(seq::text, 6, '0') ELSE seq::text END
) STORED;
CREATE UNIQUE INDEX cards_code ON cards (code);
