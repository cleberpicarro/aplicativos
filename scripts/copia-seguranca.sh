#!/usr/bin/env bash
# Item 97: copia o banco de produção, tranca a cópia com senha e prova que ela restaura.
# Usado pelo .github/workflows/copia-seguranca.yml. Nunca imprime dados, só contagens.
# Variáveis: BACKUP_DATABASE_URL (banco de origem), BACKUP_PASSWORD (senha da cópia).
# Opcional: BACKUP_SKIP_INSTALL=1 (já tem o PostgreSQL certo instalado) e BACKUP_RESTORE_URL (banco vazio para o teste).
set -euo pipefail
: "${BACKUP_DATABASE_URL:?falta BACKUP_DATABASE_URL}"
: "${BACKUP_PASSWORD:?falta BACKUP_PASSWORD}"
SRC="$BACKUP_DATABASE_URL"
case "$SRC" in *sslmode=*) ;; *render.com*) SRC="$SRC$( [[ "$SRC" == *\?* ]] && echo '&' || echo '?')sslmode=require" ;; esac

# 1) Versão do banco de origem, para usar ferramentas da mesma versão.
if [ -z "${BACKUP_SKIP_INSTALL:-}" ]; then
  sudo apt-get install -y -qq postgresql-common >/dev/null
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
  sudo apt-get install -y -qq postgresql-client-17 >/dev/null
  PATH="/usr/lib/postgresql/17/bin:$PATH"
fi
V=$(psql "$SRC" -tAc "SHOW server_version_num" | cut -c1-2)
echo "Versão do banco de origem: $V"
if [ -z "${BACKUP_SKIP_INSTALL:-}" ]; then
  sudo apt-get install -y -qq "postgresql-$V" >/dev/null
  export PATH="/usr/lib/postgresql/$V/bin:$PATH"
fi

# 2) Cópia completa (formato próprio do PostgreSQL, comprimido).
mkdir -p copia
STAMP=$(date -u +%Y-%m-%d)
FILE="copia/synctasks-$STAMP.dump"
pg_dump "$SRC" --format=custom --no-owner --no-privileges --file="$FILE"
echo "Cópia feita: $(du -h "$FILE" | cut -f1)"

# 3) Contagens da origem, para comparar depois da restauração.
COUNT_SQL="SELECT 'pessoas', count(*) FROM users UNION ALL SELECT 'quadros', count(*) FROM boards UNION ALL
           SELECT 'tarefas', count(*) FROM cards UNION ALL SELECT 'comentarios', count(*) FROM comments UNION ALL
           SELECT 'log', count(*) FROM card_events UNION ALL SELECT 'delegacoes', count(*) FROM delegations ORDER BY 1"
psql "$SRC" -tAF' ' -c "$COUNT_SQL" > copia/origem.txt

# 4) Teste de restauração num banco vazio desta máquina.
if [ -z "${BACKUP_RESTORE_URL:-}" ]; then
  DATA=$(mktemp -d)
  initdb -D "$DATA" -U restaura --auth=trust >/dev/null
  pg_ctl -D "$DATA" -o "-p 5499 -k /tmp" -l "$DATA/log" start >/dev/null
  createdb -h /tmp -p 5499 -U restaura teste
  BACKUP_RESTORE_URL="postgresql://restaura@/teste?host=/tmp&port=5499"
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$BACKUP_RESTORE_URL" "$FILE"
psql "$BACKUP_RESTORE_URL" -tAF' ' -c "$COUNT_SQL" > copia/restaurada.txt
if ! diff -q copia/origem.txt copia/restaurada.txt >/dev/null; then
  echo "::error::A cópia restaurada não bate com o banco de origem."; diff copia/origem.txt copia/restaurada.txt || true; exit 1
fi
echo "Restauração testada: os números batem."
sed 's/^/  /' copia/restaurada.txt

# 5) Tranca a cópia com a senha (AES-256) e apaga a versão aberta.
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 \
    --output "$FILE.gpg" "$FILE" 3<<<"$BACKUP_PASSWORD"
rm -f "$FILE" copia/origem.txt copia/restaurada.txt
echo "Cópia trancada: $(basename "$FILE").gpg"
