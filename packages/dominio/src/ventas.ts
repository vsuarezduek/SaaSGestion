// Cálculo de una venta. Todo en centavos enteros (BigInt en los productos intermedios).
// Redondeo documentado: "mitad hacia arriba" al centavo, renglón por renglón.
//   bruto_i     = cantidad_i × precio_i                       (cantidad con 3 decimales, precio con IVA incluido)
//   subtotal_i  = bruto_i − bruto_i × descuento_i%            (descuento por renglón)
//   total_i     = subtotal_i − subtotal_i × descuentoTotal%   (el descuento total se reparte en cada renglón)
//   total       = Σ total_i          descuento total = Σ subtotal_i − total
// Descuento total por monto ("quiero que la venta cierre en $X"): el descuento D = Σ subtotal_i − X se reparte entre los renglones
// en proporción a su subtotal; los centavos sobrantes van a los renglones con mayor resto (empate: el primero), así Σ total_i = X exacto.
//   iva_i       = total_i × iva ÷ (100 + iva)                 (parte de IVA que contiene el precio final)
import type { Centavos } from './dinero.ts';
import { ivaIncluido } from './precios.ts';

export interface RenglonEntrada {
  cantidad: string;      // "2.500"
  precio: Centavos;      // unitario, IVA incluido
  descuentoPct: number;  // 0–100, hasta 2 decimales
  iva: number;           // 0 | 10.5 | 21 | 27
}
export interface RenglonCalculado { bruto: Centavos; subtotal: Centavos; total: Centavos; iva: Centavos }
export interface VentaCalculada { renglones: RenglonCalculado[]; subtotal: Centavos; descuentoTotal: Centavos; total: Centavos; ivaIncluido: Centavos }

function dividir(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (2n * den);
}
const bp = (pct: number): bigint => BigInt(Math.round(pct * 100));          // 12.5 → 1250
const milesimas = (cantidad: string): bigint => {
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(cantidad)) throw new Error(`Cantidad inválida: ${cantidad}`);
  const [e = '0', d = ''] = cantidad.split('.');
  return BigInt(e) * 1000n + BigInt(d.padEnd(3, '0'));
};
const validarPct = (pct: number): void => {
  if (!(pct >= 0 && pct <= 100)) throw new Error(`Porcentaje inválido: ${pct}`);
};

/** Descuento total: un porcentaje (0–100) o el total final al que tiene que llegar la venta (en centavos, entre 0 y el subtotal). */
export type DescuentoTotal = number | { totalFinal: Centavos };

export function calcularVenta(renglones: RenglonEntrada[], descuentoTotal: DescuentoTotal): VentaCalculada {
  const porMonto = typeof descuentoTotal === 'object';
  if (!porMonto) validarPct(descuentoTotal);
  const base = renglones.map((r) => {
    validarPct(r.descuentoPct);
    if (!Number.isInteger(r.precio) || r.precio < 0) throw new Error('Precio inválido');
    const bruto = dividir(BigInt(r.precio) * milesimas(r.cantidad), 1000n);
    return { bruto, subtotal: bruto - dividir(bruto * bp(r.descuentoPct), 10000n) };
  });
  const subtotal = base.reduce((a, r) => a + r.subtotal, 0n);
  let totales: bigint[];
  if (!porMonto) {
    totales = base.map((r) => r.subtotal - dividir(r.subtotal * bp(descuentoTotal), 10000n));
  } else {
    const T = descuentoTotal.totalFinal;
    if (!Number.isInteger(T) || T < 0) throw new Error('Total final inválido');
    if (BigInt(T) > subtotal) throw new Error('El total final no puede superar al subtotal');
    const D = subtotal - BigInt(T);
    if (subtotal === 0n) {
      totales = base.map((r) => r.subtotal);
    } else {
      const partes = base.map((r) => ({ q: (D * r.subtotal) / subtotal, resto: (D * r.subtotal) % subtotal }));
      let faltan = D - partes.reduce((a, p) => a + p.q, 0n);
      const orden = partes.map((p, i) => ({ i, resto: p.resto })).sort((a, b) => (a.resto === b.resto ? a.i - b.i : a.resto > b.resto ? -1 : 1));
      for (const o of orden) { if (faltan <= 0n) break; partes[o.i]!.q += 1n; faltan -= 1n; }
      totales = base.map((r, i) => r.subtotal - partes[i]!.q);
    }
  }
  const calculados = base.map((r, i) => ({ bruto: Number(r.bruto), subtotal: Number(r.subtotal), total: Number(totales[i]!), iva: ivaIncluido(Number(totales[i]!), renglones[i]!.iva) }));
  const total = calculados.reduce((a, r) => a + r.total, 0);
  return { renglones: calculados, subtotal: Number(subtotal), descuentoTotal: Number(subtotal) - total, total, ivaIncluido: calculados.reduce((a, r) => a + r.iva, 0) };
}

/** Comisión de un medio de pago: total × porcentaje × (1 + IVA sobre la comisión). Ej.: 3 % + 21 % de IVA. */
export function comisionDeCobro(total: Centavos, porcentaje: number, ivaSobreComision: number): Centavos {
  validarPct(porcentaje);
  validarPct(ivaSobreComision);
  return Number(dividir(BigInt(total) * bp(porcentaje) * (10000n + bp(ivaSobreComision)), 100_000_000n));
}
