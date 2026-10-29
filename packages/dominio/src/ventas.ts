// Cálculo de una venta. Todo en centavos enteros (BigInt en los productos intermedios).
// Redondeo documentado: "mitad hacia arriba" al centavo, renglón por renglón.
//   bruto_i     = cantidad_i × precio_i                       (cantidad con 3 decimales, precio con IVA incluido)
//   subtotal_i  = bruto_i − bruto_i × descuento_i%            (descuento por renglón)
//   total_i     = subtotal_i − subtotal_i × descuentoTotal%   (el descuento total se reparte en cada renglón)
//   total       = Σ total_i          descuento total = Σ subtotal_i − total
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

export function calcularVenta(renglones: RenglonEntrada[], descuentoTotalPct: number): VentaCalculada {
  validarPct(descuentoTotalPct);
  const calculados = renglones.map((r) => {
    validarPct(r.descuentoPct);
    if (!Number.isInteger(r.precio) || r.precio < 0) throw new Error('Precio inválido');
    const bruto = dividir(BigInt(r.precio) * milesimas(r.cantidad), 1000n);
    const subtotal = bruto - dividir(bruto * bp(r.descuentoPct), 10000n);
    const total = subtotal - dividir(subtotal * bp(descuentoTotalPct), 10000n);
    return { bruto: Number(bruto), subtotal: Number(subtotal), total: Number(total), iva: ivaIncluido(Number(total), r.iva) };
  });
  const subtotal = calculados.reduce((a, r) => a + r.subtotal, 0);
  const total = calculados.reduce((a, r) => a + r.total, 0);
  return { renglones: calculados, subtotal, descuentoTotal: subtotal - total, total, ivaIncluido: calculados.reduce((a, r) => a + r.iva, 0) };
}

/** Comisión de un medio de pago: total × porcentaje × (1 + IVA sobre la comisión). Ej.: 3 % + 21 % de IVA. */
export function comisionDeCobro(total: Centavos, porcentaje: number, ivaSobreComision: number): Centavos {
  validarPct(porcentaje);
  validarPct(ivaSobreComision);
  return Number(dividir(BigInt(total) * bp(porcentaje) * (10000n + bp(ivaSobreComision)), 100_000_000n));
}
