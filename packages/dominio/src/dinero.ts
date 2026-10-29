// Dinero: nunca float. Los importes viajan como texto decimal ("1234.50") y se calculan en centavos enteros.
export type Centavos = number;

const IMPORTE = /^-?\d{1,12}(\.\d{1,2})?$/;

/** "1234.5" → 123450. Solo acepta texto decimal con punto y hasta 2 decimales. */
export function aCentavos(texto: string): Centavos {
  if (!IMPORTE.test(texto)) throw new Error(`Importe inválido: ${texto}`);
  const negativo = texto.startsWith('-');
  const [enteros, decimales = ''] = texto.replace('-', '').split('.');
  const c = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
  return negativo ? -c : c;
}

/** 123450 → "1234.50" */
export function deCentavos(c: Centavos): string {
  if (!Number.isInteger(c)) throw new Error('Los centavos deben ser enteros');
  const signo = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${signo}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Texto escrito por una persona ("1.234,50", "1234,5", "1234.5") → "1234.50"; null si no se entiende. */
export function normalizarImporte(entrada: string): string | null {
  let s = entrada.trim().replace(/\s/g, '').replace(/^\$/, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.234 o 1.234.567: puntos de miles (3 decimales no existen)
  if (!IMPORTE.test(s)) return null;
  return deCentavos(aCentavos(s));
}

/** 123450 → "$ 1.234,50" (formato argentino, siempre con dos decimales). */
export function formatearPesos(c: Centavos): string {
  const signo = c < 0 ? '-' : '';
  const a = Math.abs(c);
  const enteros = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${signo}$ ${enteros},${String(a % 100).padStart(2, '0')}`;
}
