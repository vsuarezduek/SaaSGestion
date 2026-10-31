// CSV para Excel en español: separador punto y coma, comillas cuando hace falta y BOM para que respete los acentos.
export function aCsv(filas: string[][]): string {
  const celda = (x: string) => (/[;"\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  return '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}
