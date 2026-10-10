-- Item 36: filtros salvos da visão em tabela. Cada filtro é da própria pessoa (ninguém vê o de outro).
CREATE TABLE saved_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id),
  name       varchar(80) NOT NULL,
  filter     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_filters_owner ON saved_filters (owner_id, name);

-- Item 35: a tela "Arquivadas" ordena pela data de arquivamento.
CREATE INDEX cards_owner_archived ON cards (owner_id, archived_at DESC) WHERE archived_at IS NOT NULL;
