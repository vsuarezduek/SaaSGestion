// Cantidades (stock): hasta 3 decimales, siempre como texto decimal ("12.500"); nunca float.
const CANTIDAD = /^-?\d{1,11}(\.\d{1,3})?$/;

/**
 * Texto escrito por una persona → "12.500"; null si no se entiende.
 * Con coma, la coma es el decimal y los puntos son de miles ("1.234,5" → 1234.500).
 * Sin coma, el punto es el decimal ("1.5" → 1.500): una cantidad como 1.500 kg es 1,5.
 */
export function normalizarCantidad(entrada: string): string | null {
  let s = entrada.trim().replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!CANTIDAD.test(s)) return null;
  const negativo = s.startsWith('-');
  const [enteros, decimales = ''] = s.replace('-', '').split('.');
  return `${negativo ? '-' : ''}${Number(enteros)}.${decimales.padEnd(3, '0')}`;
}

/** "12.500" → "12,5"; "-3.000" → "-3". Formato argentino sin ceros de más. */
export function formatearCantidad(texto: string): string {
  const negativo = texto.startsWith('-');
  const [enteros = '0', decimales = ''] = texto.replace('-', '').split('.');
  const miles = enteros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = decimales.replace(/0+$/, '');
  return `${negativo ? '-' : ''}${miles}${dec ? ',' + dec : ''}`;
}

/** Estado de stock para avisar: negativo, bajo el mínimo, o normal. */
export function estadoStock(stock: string, minimo: string): 'negativo' | 'bajo_minimo' | 'normal' {
  const s = Math.round(Number(stock) * 1000);
  const m = Math.round(Number(minimo) * 1000);
  if (s < 0) return 'negativo';
  if (m > 0 && s < m) return 'bajo_minimo';
  return 'normal';
}
