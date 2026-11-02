// Informes de clientes y proveedores: cuánto se les vendió / compró en un período, ticket promedio, saldo y última operación.
// Ventas cerradas (las notas de crédito restan) y compras cerradas; todo en centavos enteros.
import { ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import type { Periodo } from './estadisticas.ts';
import { exigir } from './permisos.ts';

const TZ = 'America/Argentina/Buenos_Aires';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TipoPersona = 'cliente' | 'proveedor';
export interface FilaInforme { id: string; nombre: string; total: number; operaciones: number; ticketPromedio: number; saldo: number; ultima: Date | null }
export interface Perfil { total: number; operaciones: number; ticketPromedio: number; desde: Date; ultima: Date | null; topProductos: { nombre: string; monto: number }[] }

const rango = `>= ($1::date::timestamp AT TIME ZONE '${TZ}') AND o.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`;

export async function informeDePersonas(s: SesionActiva, tipo: TipoPersona, periodo: Periodo, soloConDeuda = false): Promise<FilaInforme[]> {
  exigir(s, 'informes');
  if (!FECHA.test(periodo.desde) || !FECHA.test(periodo.hasta)) throw new ErrorDeUsuario('Las fechas no son válidas');
  const c1 = tipo === 'cliente';
  const op = c1 ? 'ventas' : 'compras', col = c1 ? 'cliente_id' : 'proveedor_id', tabla = c1 ? 'clientes' : 'proveedores';
  const signo = c1 ? `(CASE WHEN o.comprobante = 'nota_credito' THEN -1 ELSE 1 END)` : '1';
  const cuenta = c1 ? `count(*) FILTER (WHERE o.id IS NOT NULL AND o.comprobante <> 'nota_credito')` : 'count(o.id)';
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ id: string; nombre: string; total: string; n: string; saldo: string; ultima: Date | null }>(
      `SELECT p.id, p.nombre,
              COALESCE(sum(o.total * ${signo}) FILTER (WHERE o.id IS NOT NULL), 0) * 100 AS total,
              ${cuenta} AS n,
              (SELECT COALESCE(sum(m.importe), 0) * 100 FROM cuenta_corriente_movimientos m WHERE m.${col} = p.id) AS saldo,
              max(o.fecha) AS ultima
         FROM ${tabla} p
         LEFT JOIN ${op} o ON o.tenant_id = p.tenant_id AND o.${col} = p.id AND o.estado = 'cerrada' AND o.fecha ${rango}
        GROUP BY p.id, p.nombre
       HAVING ${soloConDeuda ? '(SELECT COALESCE(sum(m.importe), 0) FROM cuenta_corriente_movimientos m WHERE m.' + col + ' = p.id) >= 1' : 'count(o.id) > 0 OR (SELECT COALESCE(sum(m.importe), 0) FROM cuenta_corriente_movimientos m WHERE m.' + col + ' = p.id) <> 0'}
        ORDER BY 3 DESC, lower(p.nombre) LIMIT 500`, [periodo.desde, periodo.hasta]);
    return r.rows.map((f) => {
      const total = Math.round(Number(f.total)), n = Number(f.n);
      return { id: f.id, nombre: f.nombre, total, operaciones: n, ticketPromedio: n ? Math.round(total / n) : 0, saldo: Math.round(Number(f.saldo)), ultima: f.ultima };
    });
  });
}

/** Perfil de un cliente o proveedor: todo su historial (sin período). */
export async function perfilDe(s: SesionActiva, tipo: TipoPersona, id: string): Promise<Perfil | null> {
  exigir(s, tipo === 'cliente' ? 'clientes' : 'proveedores');
  if (!UUID.test(id)) return null;
  const c1 = tipo === 'cliente';
  const op = c1 ? 'ventas' : 'compras', col = c1 ? 'cliente_id' : 'proveedor_id', tabla = c1 ? 'clientes' : 'proveedores';
  const signo = c1 ? `(CASE WHEN o.comprobante = 'nota_credito' THEN -1 ELSE 1 END)` : '1';
  const cuenta = c1 ? `count(*) FILTER (WHERE o.comprobante <> 'nota_credito')` : 'count(*)';
  const ren = c1 ? 'venta_renglones' : 'compra_renglones', fk = c1 ? 'venta_id' : 'compra_id', monto = c1 ? `r.total * ${signo}` : 'r.neto';
  return conTenant(s.tenantId, async (c) => {
    const p = await c.query<{ creado_en: Date }>(`SELECT creado_en FROM ${tabla} WHERE id = $1`, [id]);
    if (p.rowCount === 0) return null;
    const t = (await c.query<{ total: string; n: string; ultima: Date | null }>(
      `SELECT COALESCE(sum(o.total * ${signo}), 0) * 100 AS total, ${cuenta} AS n, max(o.fecha) AS ultima FROM ${op} o WHERE o.${col} = $1 AND o.estado = 'cerrada'`, [id])).rows[0]!;
    const top = await c.query<{ nombre: string; monto: string }>(
      `SELECT COALESCE(NULLIF(r.descripcion, ''), pr.nombre, 'Ítem libre') AS nombre, sum(${monto}) * 100 AS monto
         FROM ${op} o JOIN ${ren} r ON r.tenant_id = o.tenant_id AND r.${fk} = o.id LEFT JOIN productos pr ON pr.id = r.producto_id
        WHERE o.${col} = $1 AND o.estado = 'cerrada' GROUP BY 1 HAVING sum(${monto}) > 0 ORDER BY 2 DESC LIMIT 5`, [id]);
    const total = Math.round(Number(t.total)), n = Number(t.n);
    return { total, operaciones: n, ticketPromedio: n ? Math.round(total / n) : 0, desde: p.rows[0]!.creado_en, ultima: t.ultima, topProductos: top.rows.map((f) => ({ nombre: f.nombre, monto: Math.round(Number(f.monto)) })) };
  });
}
