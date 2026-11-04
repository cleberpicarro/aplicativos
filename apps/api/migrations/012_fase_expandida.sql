-- Item 85: fase recolhida no quadro (fica gravado na conta) e limite opcional de tarefas da fase
-- (acima dele o contador fica laranja). As fases são pessoais, então a escolha fica na própria fase.
ALTER TABLE lists ADD COLUMN collapsed boolean NOT NULL DEFAULT false;
ALTER TABLE lists ADD COLUMN card_limit integer CHECK (card_limit IS NULL OR card_limit BETWEEN 1 AND 9999);
