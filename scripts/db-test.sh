#!/usr/bin/env bash
# Corre los tests de base de datos (packages/db/tests/*.sql) contra DATABASE_URL.
# La base debe estar vacía o descartable: los tests crean y no limpian comercios de prueba.
set -euo pipefail
: "${DATABASE_URL:?Falta DATABASE_URL}"
DIR="$(cd "$(dirname "$0")/../packages/db/tests" && pwd)"
fallo=0
for f in "$DIR"/*.sql; do
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -f "$f" >/tmp/db-test.out 2>&1; then
    echo "OK   $(basename "$f")"
  else
    echo "FALLA $(basename "$f")"; cat /tmp/db-test.out; fallo=1
  fi
done
exit $fallo
