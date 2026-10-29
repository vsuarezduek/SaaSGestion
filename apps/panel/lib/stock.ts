// Stock: libro de solo agregar. El stock actual es la suma de movimientos; puede quedar negativo (se alerta).
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaMovimientoStock, primerError } from './validacion.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MovimientoStock {
  id: string; tipo: string; cantidad: string; concepto: string | null; revertido: boolean; creadoEn: Date; usuario: string | null;
}

export async function movimientosDeStock(s: SesionActiva, productoId: string, limite = 50): Promise<MovimientoStock[]> {
  exigir(s, 'productos');
  if (!UUID.test(productoId)) return [];
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT m.id::text, m.tipo, m.cantidad::text, m.concepto, m.creado_en, u.nombre AS usuario,
              EXISTS (SELECT 1 FROM stock_movimientos x WHERE x.revierte_id = m.id) AS revertido
         FROM stock_movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.producto_id = $1 ORDER BY m.id DESC LIMIT ${Math.min(Math.max(limite, 1), 500)}`,
      [productoId],
    );
    return r.rows.map((f) => ({ id: f.id, tipo: f.tipo, cantidad: f.cantidad, concepto: f.concepto, revertido: f.revertido, creadoEn: f.creado_en, usuario: f.usuario }));
  });
}

/** Saldo inicial o ajuste manual: + entra, − sale. No modifica movimientos anteriores. */
export async function registrarStock(s: SesionActiva, productoId: string, entrada: unknown): Promise<string> {
  exigir(s, 'productos');
  const v = esquemaMovimientoStock.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  if (!UUID.test(productoId)) throw new ErrorDeUsuario('El producto no existe');
  try {
    return await conTenant(s.tenantId, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id)
         VALUES (app.tenant_id(), $1, $2, $3, $4, $5) RETURNING id::text`,
        [productoId, v.data.tipo, v.data.cantidad, v.data.concepto, s.usuarioId],
      );
      await auditar(c, s.usuarioId, 'movimiento', 'stock', { productoId, ...v.data }, { entidadId: r.rows[0]!.id });
      return r.rows[0]!.id;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23503') throw new ErrorDeUsuario('El producto no existe');
    throw e;
  }
}

/** Corrige generando el movimiento inverso que referencia al original. */
export async function revertirStock(s: SesionActiva, productoId: string, movimientoId: string): Promise<string> {
  exigir(s, 'productos');
  if (!/^\d+$/.test(movimientoId) || !UUID.test(productoId)) throw new ErrorDeUsuario('El movimiento no existe');
  return conTenant(s.tenantId, async (c) => {
    const o = await c.query<{ cantidad: string; tipo: string }>('SELECT cantidad::text, tipo FROM stock_movimientos WHERE id = $1 AND producto_id = $2', [movimientoId, productoId]);
    const orig = o.rows[0];
    if (!orig) throw new ErrorDeUsuario('El movimiento no existe');
    if (orig.tipo === 'reversion') throw new ErrorDeUsuario('Una reversión no se puede revertir');
    const inversa = orig.cantidad.startsWith('-') ? orig.cantidad.slice(1) : '-' + orig.cantidad;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, revierte_id, usuario_id)
         VALUES (app.tenant_id(), $1, 'reversion', $2, 'Reversión', $3, $4) RETURNING id::text`,
        [productoId, inversa, movimientoId, s.usuarioId],
      );
      await auditar(c, s.usuarioId, 'revertir', 'stock', { revierte: movimientoId }, { entidadId: r.rows[0]!.id });
      return r.rows[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ese movimiento ya fue revertido');
      throw e;
    }
  });
}

export interface ResumenAlertas { negativos: { id: string; nombre: string; stock: string }[]; bajoMinimo: { id: string; nombre: string; stock: string; minimo: string }[] }

/** Productos activos con stock negativo o por debajo del mínimo (para Inicio). */
export async function alertasDeStock(s: SesionActiva, max = 20): Promise<ResumenAlertas> {
  exigir(s, 'productos');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ id: string; nombre: string; stock: string; minimo: string }>(
      `SELECT * FROM (
         SELECT p.id, p.nombre, p.stock_minimo::text AS minimo,
                (SELECT COALESCE(sum(sm.cantidad), 0) FROM stock_movimientos sm WHERE sm.producto_id = p.id)::text AS stock
           FROM productos p WHERE p.activo) t
        WHERE t.stock::numeric < 0 OR (t.minimo::numeric > 0 AND t.stock::numeric < t.minimo::numeric)
        ORDER BY t.stock::numeric, lower(t.nombre) LIMIT ${Math.min(Math.max(max, 1), 200)}`,
    );
    return {
      negativos: r.rows.filter((f) => Number(f.stock) < 0).map(({ id, nombre, stock }) => ({ id, nombre, stock })),
      bajoMinimo: r.rows.filter((f) => Number(f.stock) >= 0).map((f) => f),
    };
  });
}
