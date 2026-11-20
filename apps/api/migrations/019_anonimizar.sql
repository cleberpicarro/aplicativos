-- F7 da revisão geral (item 118): anonimizar quem saiu da empresa (LGPD). A pessoa já desativada perde nome,
-- e-mail e o conteúdo das tarefas privadas; o log e as tarefas comuns continuam, com o autor "Usuário removido".
ALTER TABLE users ADD COLUMN anonymized_at timestamptz;
