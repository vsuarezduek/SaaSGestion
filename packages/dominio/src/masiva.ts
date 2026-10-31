// Modificación masiva de costos: porcentaje o importe, redondeo al centavo "mitad lejos del cero", nunca por debajo de cero.
import type { Centavos } from './dinero.ts';

/** Nuevo costo = costo + (costo × pct%) o costo + importe. Un costo no baja de 0. */
export function ajustarCosto(costo: Centavos, tipo: 'pct' | 'imp', valor: number): Centavos {
  if (!Number.isInteger(costo) || costo < 0) throw new Error('Costo inválido');
  if (!Number.isFinite(valor)) throw new Error('Valor inválido');
  let delta: bigint;
  if (tipo === 'imp') {
    if (!Number.isInteger(valor)) throw new Error('El importe debe estar en centavos enteros');
    delta = BigInt(valor);
  } else {
    const bp = BigInt(Math.round(valor * 100));                 // 12,5 % → 1250
    const num = BigInt(costo) * bp;
    const abs = num < 0n ? -num : num;
    const r = (abs * 2n + 10000n) / 20000n;                      // mitad hacia arriba sobre el valor absoluto
    delta = num < 0n ? -r : r;
  }
  const nuevo = BigInt(costo) + delta;
  return nuevo < 0n ? 0 : Number(nuevo);
}
