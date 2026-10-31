// Cálculo de una compra. Todo en centavos enteros (BigInt en los productos intermedios).
// A diferencia de la venta, el costo de la compra viene SIN IVA: si el comprobante es factura, el IVA se suma encima.
// Redondeo documentado: "mitad hacia arriba" al centavo, renglón por renglón.
//   bruto_i    = cantidad_i × costo_i
//   subtotal_i = bruto_i − bruto_i × descuento_i%             (descuento por renglón)
//   neto_i     = subtotal_i − subtotal_i × descuentoTotal%    (el descuento total se reparte en cada renglón)
//   iva_i      = neto_i × iva_i%                              (solo si el comprobante discrimina IVA: factura A o B)
//   total      = Σ neto_i + Σ iva_i
import type { Centavos } from './dinero.ts';

export interface RenglonCompraEntrada {
  cantidad: string;      // "2.500"
  costo: Centavos;       // unitario, sin IVA
  descuentoPct: number;  // 0–100
  iva: number;           // 0 | 10.5 | 21 | 27
}
export interface RenglonCompraCalculado { bruto: Centavos; subtotal: Centavos; neto: Centavos; iva: Centavos }
export interface CompraCalculada { renglones: RenglonCompraCalculado[]; subtotal: Centavos; descuentoTotal: Centavos; neto: Centavos; iva: Centavos; total: Centavos }

const dividir = (num: bigint, den: bigint): bigint => (num * 2n + den) / (2n * den);
const bp = (pct: number): bigint => BigInt(Math.round(pct * 100));
const milesimas = (cantidad: string): bigint => {
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(cantidad)) throw new Error(`Cantidad inválida: ${cantidad}`);
  const [e = '0', d = ''] = cantidad.split('.');
  return BigInt(e) * 1000n + BigInt(d.padEnd(3, '0'));
};
const validarPct = (pct: number): void => {
  if (!(pct >= 0 && pct <= 100)) throw new Error(`Porcentaje inválido: ${pct}`);
};

export function calcularCompra(renglones: RenglonCompraEntrada[], descuentoTotalPct: number, conIva: boolean): CompraCalculada {
  validarPct(descuentoTotalPct);
  const calc = renglones.map((r) => {
    validarPct(r.descuentoPct);
    if (!Number.isInteger(r.costo) || r.costo < 0) throw new Error('Costo inválido');
    const bruto = dividir(BigInt(r.costo) * milesimas(r.cantidad), 1000n);
    const subtotal = bruto - dividir(bruto * bp(r.descuentoPct), 10000n);
    const neto = subtotal - dividir(subtotal * bp(descuentoTotalPct), 10000n);
    // IVA en décimas de punto (10.5 → 105) sobre el neto del renglón
    const iva = conIva ? dividir(neto * BigInt(Math.round(r.iva * 10)), 1000n) : 0n;
    return { bruto: Number(bruto), subtotal: Number(subtotal), neto: Number(neto), iva: Number(iva) };
  });
  const subtotal = calc.reduce((a, r) => a + r.subtotal, 0);
  const neto = calc.reduce((a, r) => a + r.neto, 0);
  const iva = calc.reduce((a, r) => a + r.iva, 0);
  return { renglones: calc, subtotal, descuentoTotal: subtotal - neto, neto, iva, total: neto + iva };
}

/** Impuesto por transacción de una caja (banco/billetera) sobre lo que sale: importe × porcentaje. */
export function impuestoDeTransaccion(importe: Centavos, porcentaje: number): Centavos {
  validarPct(porcentaje);
  return Number(dividir(BigInt(importe) * bp(porcentaje), 10000n));
}
