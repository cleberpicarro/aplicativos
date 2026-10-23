-- Item 66: na tela Pessoas (administração), a caixa "Esconder inativas" fica gravada na conta de cada pessoa.
ALTER TABLE users ADD COLUMN hide_inactive boolean NOT NULL DEFAULT false;
