// Costos fijos: se eligen productos que representan costos (alquiler, luz, personal…) con una cantidad mensual cada uno.
// Total mensual ÷ lo elaborado en los últimos N días = costo fijo por unidad, repartido por unidades o por costo de ingredientes.
// Cuando está activado, se suma al costo de cada producto elaborado. Sin elaboraciones en el período, el costo fijo es 0.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { aCentavos, costoFijoPorUnidad, costoIngredientes, deCentavos, normalizarCantidad } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Costo de ingredientes por unidad del producto (centavos). Sin receta, 0. */
export async function costoIngredientesDe(c: PoolClient, productoId: string): Promise<number> {
  const r = await c.query<{ rinde: string; cantidad: string | null; costo: string | null }>(
    `SELECT p.rinde::text AS rinde, ri.cantidad::text AS cantidad, i.costo::text AS costo
       FROM productos p LEFT JOIN receta_ingredientes ri ON ri.producto_id = p.id LEFT JOIN productos i ON i.id = ri.ingrediente_id WHERE p.id = $1`, [productoId]);
  if (r.rows.length === 0) return 0;
  const ing = r.rows.filter((f) => f.cantidad !== null).map((f) => ({ cantidad: f.cantidad!, costo: aCentavos(f.costo!) }));
  return costoIngredientes(ing, r.rows[0]!.rinde);
}

interface Config { activo: boolean; dias: number; base: 'unidades' | 'costo_ingredientes' }

async function configEn(c: PoolClient): Promise<Config> {
  const r = await c.query<{ activo: boolean; dias: number; base: 'unidades' | 'costo_ingredientes' }>('SELECT activo, dias, base FROM costos_fijos_config');
  return r.rows[0] ?? { activo: false, dias: 30, base: 'unidades' };
}

/** Total mensual de los costos fijos cargados, en centavos. */
async function totalMensualEn(c: PoolClient): Promise<number> {
  const r = await c.query<{ cantidad: string; costo: string }>('SELECT i.cantidad::text AS cantidad, p.costo::text AS costo FROM costos_fijos_items i JOIN productos p ON p.id = i.producto_id');
  return r.rows.reduce((a, f) => a + costoIngredientes([{ cantidad: f.cantidad, costo: aCentavos(f.costo) }], '1'), 0);
}

/** Producción cerrada del período, por producto, con su costo de ingredientes por unidad. */
async function produccionEn(c: PoolClient, dias: number): Promise<{ productoId: string; unidades: string; costoIngredientes: number }[]> {
  const r = await c.query<{ producto_id: string; unidades: string }>(
    `SELECT producto_id, sum(cantidad)::text AS unidades FROM elaboraciones
      WHERE estado = 'cerrada' AND fecha >= now() - ($1::int * interval '1 day') GROUP BY producto_id`, [dias]);
  const out = [];
  for (const f of r.rows) out.push({ productoId: f.producto_id, unidades: f.unidades, costoIngredientes: await costoIngredientesDe(c, f.producto_id) });
  return out;
}

/** Costo fijo por unidad de un producto elaborado (centavos) y si el costo fijo está activado. */
export async function costoFijoDe(c: PoolClient, _productoId: string, costoIngProducto: number): Promise<{ activo: boolean; porUnidad: number }> {
  const cfg = await configEn(c);
  if (!cfg.activo) return { activo: false, porUnidad: 0 };
  const total = await totalMensualEn(c);
  if (total <= 0) return { activo: true, porUnidad: 0 };
  const prod = await produccionEn(c, cfg.dias);
  return { activo: true, porUnidad: costoFijoPorUnidad(total, cfg.base, prod.map((p) => ({ unidades: p.unidades, costoIngredientes: p.costoIngredientes })), costoIngProducto) };
}

export interface CostosFijos {
  activo: boolean; dias: number; base: 'unidades' | 'costo_ingredientes'; totalMensual: string;
  items: { productoId: string; nombre: string; costo: string; cantidad: string; subtotal: string }[];
  produccion: { productoId: string; nombre: string; unidades: string; costoFijoPorUnidad: string; costoPorUnidad: string }[];
}

export async function obtenerCostosFijos(s: SesionActiva): Promise<CostosFijos> {
  exigir(s, 'productos');
  return conTenant(s.tenantId, async (c) => {
    const cfg = await configEn(c);
    const it = await c.query<{ producto_id: string; nombre: string; costo: string; cantidad: string }>(
      'SELECT i.producto_id, p.nombre, p.costo::text AS costo, i.cantidad::text AS cantidad FROM costos_fijos_items i JOIN productos p ON p.id = i.producto_id ORDER BY lower(p.nombre)');
    const total = await totalMensualEn(c);
    const prod = await produccionEn(c, cfg.dias);
    const filas = [];
    for (const p of prod) {
      const n = await c.query<{ nombre: string }>('SELECT nombre FROM productos WHERE id = $1', [p.productoId]);
      const fijo = total > 0 ? costoFijoPorUnidad(total, cfg.base, prod.map((x) => ({ unidades: x.unidades, costoIngredientes: x.costoIngredientes })), p.costoIngredientes) : 0;
      filas.push({ productoId: p.productoId, nombre: n.rows[0]?.nombre ?? '', unidades: p.unidades, costoFijoPorUnidad: deCentavos(fijo), costoPorUnidad: deCentavos(p.costoIngredientes + (cfg.activo ? fijo : 0)) });
    }
    filas.sort((a, b) => Number(b.unidades) - Number(a.unidades));
    return {
      ...cfg, totalMensual: deCentavos(total),
      items: it.rows.map((f) => ({ productoId: f.producto_id, nombre: f.nombre, costo: f.costo, cantidad: f.cantidad, subtotal: deCentavos(costoIngredientes([{ cantidad: f.cantidad, costo: aCentavos(f.costo) }], '1')) })),
      produccion: filas,
    };
  });
}

export async function guardarConfigCostosFijos(s: SesionActiva, cfg: { activo: boolean; dias: number; base: string }): Promise<void> {
  exigir(s, 'ajustes');
  if (cfg.base !== 'unidades' && cfg.base !== 'costo_ingredientes') throw new ErrorDeUsuario('Elegí cómo repartir el costo fijo');
  if (!Number.isInteger(cfg.dias) || cfg.dias < 1 || cfg.dias > 365) throw new ErrorDeUsuario('El período debe ser de 1 a 365 días');
  await conTenant(s.tenantId, async (c) => {
    const antes = await configEn(c);
    await c.query(
      `INSERT INTO costos_fijos_config (tenant_id, activo, dias, base) VALUES (app.tenant_id(), $1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET activo = EXCLUDED.activo, dias = EXCLUDED.dias, base = EXCLUDED.base`, [!!cfg.activo, cfg.dias, cfg.base]);
    await auditar(c, s.usuarioId, 'modificar', 'costos_fijos', { activo: !!cfg.activo, dias: cfg.dias, base: cfg.base }, { antes });
  });
}

export async function agregarCostoFijo(s: SesionActiva, productoId: string): Promise<void> {
  exigir(s, 'ajustes');
  if (!UUID.test(productoId)) throw new ErrorDeUsuario('El producto no existe');
  await conTenant(s.tenantId, async (c) => {
    const p = await c.query('SELECT 1 FROM productos WHERE id = $1 AND activo', [productoId]);
    if (p.rowCount === 0) throw new ErrorDeUsuario('El producto no existe o está archivado');
    await c.query('INSERT INTO costos_fijos_items (tenant_id, producto_id, cantidad) VALUES (app.tenant_id(), $1, 1) ON CONFLICT DO NOTHING', [productoId]);
    await auditar(c, s.usuarioId, 'modificar', 'costos_fijos', { agrega: productoId });
  });
}

export async function fijarCantidadCostoFijo(s: SesionActiva, productoId: string, cantidad: string): Promise<void> {
  exigir(s, 'ajustes');
  const n = normalizarCantidad(String(cantidad ?? ''));
  if (n === null || Number(n) <= 0) throw new ErrorDeUsuario('La cantidad debe ser mayor que cero');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('UPDATE costos_fijos_items SET cantidad = $2 WHERE producto_id = $1', [productoId, n]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('Ese costo no está cargado');
    await auditar(c, s.usuarioId, 'modificar', 'costos_fijos', { producto: productoId, cantidad: n });
  });
}

export async function quitarCostoFijo(s: SesionActiva, productoId: string): Promise<void> {
  exigir(s, 'ajustes');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('DELETE FROM costos_fijos_items WHERE producto_id = $1', [productoId]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('Ese costo no está cargado');
    await auditar(c, s.usuarioId, 'modificar', 'costos_fijos', { quita: productoId });
  });
}
