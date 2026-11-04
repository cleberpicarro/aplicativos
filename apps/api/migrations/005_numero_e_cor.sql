-- Item 37: código só numérico, com numeração própria em cada quadro e na caixa de entrada de cada pessoa.
-- O número único antigo (seq / code ST-…) continua guardado por dentro: links e códigos antigos seguem abrindo a tarefa.
ALTER TABLE boards ADD COLUMN next_num integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN inbox_next_num integer NOT NULL DEFAULT 1;
ALTER TABLE cards ADD COLUMN num integer;

-- Tarefas que já existem: 1, 2, 3… em cada quadro (ou caixa de entrada) pela ordem de criação.
WITH n AS (
  SELECT c.id, row_number() OVER (PARTITION BY coalesce(l.board_id::text, 'caixa:' || c.owner_id::text) ORDER BY c.seq) AS num
    FROM cards c LEFT JOIN lists l ON l.id = c.list_id
)
UPDATE cards c SET num = n.num FROM n WHERE n.id = c.id;

UPDATE boards b SET next_num = coalesce(
  (SELECT max(c.num) FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = b.id), 0) + 1;
UPDATE users u SET inbox_next_num = coalesce(
  (SELECT max(c.num) FROM cards c WHERE c.owner_id = u.id AND c.list_id IS NULL), 0) + 1;

-- Dá o próximo número do quadro (ou da caixa de entrada) sempre que a tarefa nasce ou chega a outro lugar:
-- criar, capturar, delegar, aceitar, mover de quadro, devolver, redelegar, transferir e desarquivar.
-- Arquivar tirando a tarefa do quadro (cancelamento) mantém o número que ela tinha.
CREATE FUNCTION card_container(p_list uuid, p_owner uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_list IS NULL THEN 'caixa:' || p_owner::text
              ELSE 'quadro:' || (SELECT board_id::text FROM lists WHERE id = p_list) END
$$;

CREATE FUNCTION card_assign_num() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  board uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.archived_at IS NOT NULL
       OR card_container(NEW.list_id, NEW.owner_id) = card_container(OLD.list_id, OLD.owner_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.list_id IS NULL THEN
    UPDATE users SET inbox_next_num = inbox_next_num + 1 WHERE id = NEW.owner_id RETURNING inbox_next_num - 1 INTO NEW.num;
  ELSE
    SELECT board_id INTO board FROM lists WHERE id = NEW.list_id;
    UPDATE boards SET next_num = next_num + 1 WHERE id = board RETURNING next_num - 1 INTO NEW.num;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cards_num BEFORE INSERT OR UPDATE OF list_id, owner_id, archived_at ON cards
  FOR EACH ROW EXECUTE FUNCTION card_assign_num();

ALTER TABLE cards ALTER COLUMN num SET NOT NULL;
CREATE INDEX cards_num ON cards (owner_id, num);

-- Item 38: cor de um cartão só (nome de uma cor da paleta; NULL = sem cor). É de quem é dono do cartão.
ALTER TABLE cards ADD COLUMN color text;
