#!/usr/bin/env bash
# Corre un comando; si falla, muestra el final de su salida como anotación visible en GitHub.
# Uso: scripts/ci-anotar.sh "Título" comando args...
titulo="$1"; shift
set +e
salida="$("$@" 2>&1)"; codigo=$?
echo "$salida"
if [ $codigo -ne 0 ]; then
  resumen="$(echo "$salida" | tail -c 1800 | sed ':a;N;$!ba;s/%/%25/g;s/\r//g;s/\n/%0A/g')"
  echo "::error title=$titulo::$resumen"
fi
exit $codigo
