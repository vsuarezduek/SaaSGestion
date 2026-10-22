#!/usr/bin/env bash
# Aplica las migraciones de packages/db/migraciones en orden, una sola vez cada una.
# Uso: DATABASE_URL=postgres://... scripts/db-migrar.sh
# Regla: una migración ya aplicada NO se edita; si su contenido cambió, este script falla.
set -euo pipefail
: "${DATABASE_URL:?Falta DATABASE_URL}"
DIR="$(cd "$(dirname "$0")/../packages/db/migraciones" && pwd)"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS _migraciones (
  nombre text PRIMARY KEY, sha256 text NOT NULL, aplicada_en timestamptz NOT NULL DEFAULT now())"

for f in "$DIR"/*.sql; do
  n="$(basename "$f")"
  h="$(sha256sum "$f" | cut -d' ' -f1)"
  previo="$("${PSQL[@]}" -tA -c "SELECT sha256 FROM _migraciones WHERE nombre = '$n'")"
  if [[ -n "$previo" ]]; then
    if [[ "$previo" != "$h" ]]; then
      echo "ERROR: la migración $n ya fue aplicada y su contenido cambió. Crear una migración nueva en vez de editarla." >&2
      exit 1
    fi
    echo "= $n (ya aplicada)"; continue
  fi
  echo "+ $n"
  { echo "BEGIN;"; cat "$f"; echo "INSERT INTO _migraciones (nombre, sha256) VALUES ('$n', '$h');"; echo "COMMIT;"; } \
    | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q
done
echo "Migraciones al día."
