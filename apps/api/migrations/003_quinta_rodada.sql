-- Quinta rodada.

-- Item 24: cor de fundo da área de trabalho, escolhida por cada pessoa (nome de uma cor da paleta; NULL = padrão, branco).
ALTER TABLE users ADD COLUMN workspace_bg text;
