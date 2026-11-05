// Compras abiertas: borradores de compra. Todos los usuarios con acceso a Compras ven y pueden retomar las de todos.
// No mueven caja, stock ni cuenta corriente: eso pasa recién al cerrar la compra.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaBorradorCompra, primerError, type BorradorCompra } from './validacion.ts';
import { normalizarImporte } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ConflictoDeVersionCompra extends ErrorDeUsuario {}

export interface FilaCompraAbierta { id: string; proveedorId: string; proveedor: string; renglones: number; total: string; creadaPor: string | null; modificadaPor: string | null; modificadoEn: Date }

export async function listarComprasAbiertas(s: SesionActiva): Promise<FilaCompraAbierta[]> {
  exigir(s, 'compras');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT a.id, a.proveedor_id, p.nombre AS proveedor, a.renglones, a.total::text, uc.nombre AS creada_por, um.nombre AS modificada_por, a.modificado_en
         FROM compras_abiertas a JOIN proveedores p ON p.id = a.proveedor_id
         LEFT JOIN usuarios uc ON uc.id = a.creada_por LEFT JOIN usuarios um ON um.id = a.modificada_por
        WHERE a.estado = 'abierta' ORDER BY a.modificado_en DESC LIMIT 100`);
    return r.rows.map((f) => ({ id: f.id, proveedorId: f.proveedor_id, proveedor: f.proveedor, renglones: f.renglones, total: f.total, creadaPor: f.creada_por, modificadaPor: f.modificada_por, modificadoEn: f.modificado_en }));
  });
}

export interface CompraAbierta { id: string; version: number; datos: BorradorCompra; proveedor: { id: string; nombre: string; saldo: string } }

export async function obtenerCompraAbierta(s: SesionActiva, id: string): Promise<CompraAbierta | null> {
  exigir(s, 'compras');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ id: string; version: number; datos: unknown }>("SELECT id, version, datos FROM compras_abiertas WHERE id = $1 AND estado = 'abierta'", [id]);
    const f = r.rows[0];
    if (!f) return null;
    const datos = esquemaBorradorCompra.safeParse(f.datos);
    if (!datos.success) return null;
    const p = await c.query<{ id: string; nombre: string; saldo: string }>(
      `SELECT p.id, p.nombre, COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.proveedor_id = p.id), 0)::numeric(14,2)::text AS saldo FROM proveedores p WHERE p.id = $1`, [datos.data.proveedorId]);
    if (!p.rows[0]) return null;
    return { id: f.id, version: f.version, datos: datos.data, proveedor: p.rows[0] };
  });
}

/** Crea (id = null) o actualiza una compra abierta. Si otra persona la modificó mientras tanto, avisa en vez de pisarla. */
export async function guardarCompraAbierta(s: SesionActiva, id: string | null, version: number, entrada: unknown): Promise<{ id: string; version: number }> {
  exigir(s, 'compras');
  const v = esquemaBorradorCompra.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  if (d.renglones.length === 0) throw new ErrorDeUsuario('Cargá al menos un producto para dejar la compra abierta');
  const total = normalizarImporte(d.total || '0') ?? '0';
  return conTenant(s.tenantId, async (c) => {
    try {
      if (!id) {
        const r = await c.query<{ id: string; version: number }>(
          `INSERT INTO compras_abiertas (tenant_id, proveedor_id, datos, renglones, total, creada_por, modificada_por)
           VALUES (app.tenant_id(), $1, $2::jsonb, $3, $4, $5, $5) RETURNING id, version`, [d.proveedorId, JSON.stringify(d), d.renglones.length, total, s.usuarioId]);
        await auditar(c, s.usuarioId, 'abrir', 'compra_abierta', { proveedor: d.proveedorId, renglones: d.renglones.length }, { entidadId: r.rows[0]!.id });
        return r.rows[0]!;
      }
      if (!UUID.test(id)) throw new ErrorDeUsuario('La compra abierta no existe');
      const r = await c.query<{ id: string; version: number }>(
        `UPDATE compras_abiertas SET proveedor_id = $2, datos = $3::jsonb, renglones = $4, total = $5, modificada_por = $6, modificado_en = now(), version = version + 1
          WHERE id = $1 AND estado = 'abierta' AND version = $7 RETURNING id, version`, [id, d.proveedorId, JSON.stringify(d), d.renglones.length, total, s.usuarioId, version]);
      if (r.rows[0]) return r.rows[0];
      const e = await c.query<{ estado: string }>('SELECT estado FROM compras_abiertas WHERE id = $1', [id]);
      if (!e.rows[0]) throw new ErrorDeUsuario('La compra abierta no existe');
      if (e.rows[0].estado !== 'abierta') throw new ErrorDeUsuario('Esta compra ya fue cerrada o descartada por otra persona');
      throw new ConflictoDeVersionCompra('Otra persona modificó esta compra abierta mientras la editabas. Volvé a abrirla para ver los cambios.');
    } catch (e) {
      if ((e as { code?: string }).code === '23503') throw new ErrorDeUsuario('El proveedor no existe');
      throw e;
    }
  });
}

/** Descarta una compra abierta (queda registrada como descartada, no se borra). */
export async function descartarCompraAbierta(s: SesionActiva, id: string): Promise<void> {
  exigir(s, 'compras');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La compra abierta no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ estado: string }>('SELECT estado FROM compras_abiertas WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows[0]) throw new ErrorDeUsuario('La compra abierta no existe');
    if (r.rows[0].estado !== 'abierta') throw new ErrorDeUsuario('Esta compra ya fue cerrada o descartada');
    await c.query("UPDATE compras_abiertas SET estado = 'descartada', modificada_por = $2, modificado_en = now() WHERE id = $1", [id, s.usuarioId]);
    await auditar(c, s.usuarioId, 'descartar', 'compra_abierta', {}, { entidadId: id });
  });
}
