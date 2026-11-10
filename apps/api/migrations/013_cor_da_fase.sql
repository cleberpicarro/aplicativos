-- Item 87: cor da fase (faixa colorida no topo). Mesmas 8 cores das tarefas; null = sem cor.
ALTER TABLE lists ADD COLUMN color text CHECK (color IS NULL OR color IN ('azul', 'verde', 'amarelo', 'laranja', 'vermelho', 'roxo', 'rosa', 'cinza'));
