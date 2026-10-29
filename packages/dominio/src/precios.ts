// Precios, IVA y utilidad. Todo en centavos enteros (BigInt para los productos intermedios).
// Redondeo: "mitad hacia arriba" al centavo (para valores positivos), documentado y probado.
import type { Centavos } from './dinero.ts';

export const ALICUOTAS_IVA = [0, 10.5, 21, 27] as const;
export type AlicuotaIva = (typeof ALICUOTAS_IVA)[number];

export function esAlicuotaValida(iva: number): iva is AlicuotaIva {
  return (ALICUOTAS_IVA as readonly number[]).includes(iva);
}

/** 21 → 210 (décimas de punto), para no usar decimales de coma flotante. */
function decimasIva(iva: number): bigint {
  if (!esAlicuotaValida(iva)) throw new Error(`Alícuota de IVA no válida: ${iva}`);
  return BigInt(Math.round(iva * 10));
}

/** num / den redondeado "mitad hacia arriba" (num >= 0, den > 0). */
function dividirRedondeado(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (2n * den);
}

/** Puntos básicos de un porcentaje con hasta 2 decimales: 40.5 → 4050. */
function puntosBasicos(porcentaje: number): bigint {
  return BigInt(Math.round(porcentaje * 100));
}

/** Precio final (con IVA) = costo × (1 + utilidad) × (1 + IVA). La utilidad se calcula sobre el costo, sin IVA. */
export function precioDesdeUtilidad(costo: Centavos, utilidadPct: number, iva: number): Centavos {
  if (costo < 0) throw new Error('El costo no puede ser negativo');
  if (utilidadPct < -100) throw new Error('La utilidad no puede ser menor a -100%');
  const num = BigInt(costo) * (10000n + puntosBasicos(utilidadPct)) * (1000n + decimasIva(iva));
  return Number(dividirRedondeado(num, 10_000_000n));
}

/** Utilidad % (2 decimales) que deja un precio final sobre un costo, descontando el IVA. Null si el costo es 0. */
export function utilidadDesdePrecio(costo: Centavos, precio: Centavos, iva: number): number | null {
  if (costo <= 0) return null;
  const num = BigInt(precio) * 10_000_000n;
  const den = (1000n + decimasIva(iva)) * BigInt(costo);
  const bp = dividirRedondeado(num, den) - 10000n;
  return Number(bp) / 100;
}

/** Cuando cambia el costo y se quiere mantener la utilidad: nuevo precio = precio × costo nuevo ÷ costo anterior. */
export function precioMantenerUtilidad(precio: Centavos, costoAnterior: Centavos, costoNuevo: Centavos): Centavos {
  if (costoAnterior <= 0) return precio;
  return Number(dividirRedondeado(BigInt(precio) * BigInt(costoNuevo), BigInt(costoAnterior)));
}

/** Parte de un precio final que corresponde al IVA (para facturas): precio × iva ÷ (100 + iva). */
export function ivaIncluido(precio: Centavos, iva: number): Centavos {
  return Number(dividirRedondeado(BigInt(precio) * decimasIva(iva), 1000n + decimasIva(iva)));
}
