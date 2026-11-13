-- Item 94: configurações que valem para todos (uma linha só). Destaque em cor sólida das tarefas atrasadas e das que vencem hoje.
CREATE TABLE app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  late_on boolean NOT NULL DEFAULT false,
  late_color text NOT NULL DEFAULT 'vermelho' CHECK (late_color IN ('vermelho', 'laranja', 'vinho', 'roxo', 'azul', 'grafite')),
  today_on boolean NOT NULL DEFAULT false,
  today_color text NOT NULL DEFAULT 'amarelo' CHECK (today_color IN ('amarelo', 'laranja-claro', 'verde', 'azul', 'lilas', 'cinza')),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (true);
