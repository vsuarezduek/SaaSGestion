// Recetas, elaboración y costos fijos. Todo en centavos y milésimas enteras (BigInt en los productos intermedios).
// Redondeo documentado: "mitad hacia arriba" al centavo (costos) o a la milésima (cantidades).
//   costo de ingredientes por unidad = Σ (cantidad_i × costo_i) ÷ rinde
//   insumo_i de una elaboración      = cantidad_i × cantidad elaborada ÷ rinde
//   costo fijo por unidad            = total mensual × peso(producto) ÷ Σ (unidades_j × peso_j)   (peso = 1 o costo de ingredientes)
import type { Centavos } from './dinero.ts';

const dividir = (num: bigint, den: bigint): bigint => (num * 2n + den) / (2n * den);

const milesimas = (cantidad: string): bigint => {
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(cantidad)) throw new Error(`Cantidad inválida: ${cantidad}`);
  const [e = '0', d = ''] = cantidad.split('.');
  return BigInt(e) * 1000n + BigInt(d.padEnd(3, '0'));
};

const deMilesimas = (m: bigint): string => {
  const e = m / 1000n;
  const d = (m % 1000n).toString().padStart(3, '0');
  return `${e}.${d}`;
};

export interface IngredienteCosto { cantidad: string; costo: Centavos }

/** Costo de los ingredientes por cada unidad que rinde la tanda. Sin ingredientes, 0. */
export function costoIngredientes(ingredientes: IngredienteCosto[], rinde: string): Centavos {
  const r = milesimas(rinde);
  if (r <= 0n) throw new Error('El rendimiento debe ser mayor que cero');
  let total = 0n;
  for (const i of ingredientes) {
    if (!Number.isInteger(i.costo) || i.costo < 0) throw new Error('Costo inválido');
    total += milesimas(i.cantidad) * BigInt(i.costo);
  }
  return Number(dividir(total, r));
}

/** Cuánto de un ingrediente se usa para elaborar `elaborada` unidades, según la receta de una tanda que rinde `rinde`. */
export function insumoDeElaboracion(cantidadReceta: string, elaborada: string, rinde: string): string {
  const r = milesimas(rinde);
  if (r <= 0n) throw new Error('El rendimiento debe ser mayor que cero');
  return deMilesimas(dividir(milesimas(cantidadReceta) * milesimas(elaborada), r));
}

export interface ProduccionPeriodo { unidades: string; costoIngredientes: Centavos }

/**
 * Costo fijo que le toca a cada unidad de un producto elaborado.
 * `totalMensual`: suma de los costos fijos cargados. `produccion`: lo elaborado en el período (una fila por producto).
 * `base`: 'unidades' reparte parejo por unidad; 'costo_ingredientes' reparte en proporción al costo de ingredientes.
 * Sin producción en el período, el costo fijo es 0.
 */
export function costoFijoPorUnidad(totalMensual: Centavos, base: 'unidades' | 'costo_ingredientes', produccion: ProduccionPeriodo[], costoIngProducto: Centavos): Centavos {
  if (!Number.isInteger(totalMensual) || totalMensual < 0) throw new Error('Total inválido');
  let den = 0n;
  for (const p of produccion) den += milesimas(p.unidades) * (base === 'costo_ingredientes' ? BigInt(p.costoIngredientes) : 1n);
  if (den <= 0n) return 0;
  const peso = base === 'costo_ingredientes' ? BigInt(costoIngProducto) : 1n;
  return Number(dividir(BigInt(totalMensual) * peso * 1000n, den));   // las unidades vienen en milésimas
}
