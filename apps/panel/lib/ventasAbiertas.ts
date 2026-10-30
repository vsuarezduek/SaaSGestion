// Ventas abiertas: borradores que se guardan solos. Todos los usuarios del comercio ven y pueden retomar las de todos
// (si un turno termina sin cerrar, otro la continúa). No mueven caja, stock ni cuenta corriente: eso pasa recién al cerrar la venta.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaBorrador, primerError, type Borrador } from './validacion.ts';
import { normalizarImporte } from '../../../packages/dominio/src/index.ts';
import type { ClienteParaVenta } from './ventas.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ConflictoDeVersion extends ErrorDeUsuario {}

export interface FilaAbierta { id: string; cliente: string; renglones: number; total: string; creadaPor: string | null; modificadaPor: string | null; modificadoEn: Date; creadoEn: Date }

export async function listarAbiertas(s: SesionActiva): Promise<FilaAbierta[]> {
  exigir(s, 'ventas');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT a.id, cl.nombre AS cliente, a.renglones, a.total::text, uc.nombre AS creada_por, um.nombre AS modificada_por, a.modificado_en, a.creado_en
         FROM ventas_abiertas a JOIN clientes cl ON cl.id = a.cliente_id
         LEFT JOIN usuarios uc ON uc.id = a.creada_por LEFT JOIN usuarios um ON um.id = a.modificada_por
        WHERE a.estado = 'abierta' ORDER BY a.modificado_en DESC LIMIT 100`);
    return r.rows.map((f) => ({ id: f.id, cliente: f.cliente, renglones: f.renglones, total: f.total, creadaPor: f.creada_por, modificadaPor: f.modificada_por, modificadoEn: f.modificado_en, creadoEn: f.creado_en }));
  });
}

export interface VentaAbierta { id: string; version: number; datos: Borrador; cliente: ClienteParaVenta }

export async function obtenerAbierta(s: SesionActiva, id: string): Promise<VentaAbierta | null> {
  exigir(s, 'ventas');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ id: string; version: number; datos: unknown }>("SELECT id, version, datos FROM ventas_abiertas WHERE id = $1 AND estado = 'abierta'", [id]);
    const f = r.rows[0];
    if (!f) return null;
    const datos = esquemaBorrador.safeParse(f.datos);
    if (!datos.success) return null;
    const cl = await c.query(
      `SELECT c.id, c.nombre, c.es_consumidor_final, k.lista_id, COALESCE(k.descuento, 0)::text AS descuento, COALESCE(k.cuenta_corriente, false) AS cc,
              COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.cliente_id = c.id), 0)::numeric(14,2)::text AS saldo
         FROM clientes c LEFT JOIN categorias_cliente k ON k.tenant_id = c.tenant_id AND k.id = c.categoria_id WHERE c.id = $1`, [datos.data.clienteId]);
    const x = cl.rows[0];
    if (!x) return null;
    return {
      id: f.id, version: f.version, datos: datos.data,
      cliente: { id: x.id, nombre: x.nombre, saldo: x.saldo, listaId: x.lista_id, descuento: Number(x.descuento), cuentaCorriente: x.cc && !x.es_consumidor_final, esConsumidorFinal: x.es_consumidor_final },
    };
  });
}

/** Crea (id = null) o actualiza una venta abierta. Si otra persona la modificó mientras tanto, avisa en vez de pisarla. */
export async function guardarAbierta(s: SesionActiva, id: string | null, version: number, entrada: unknown): Promise<{ id: string; version: number }> {
  exigir(s, 'ventas');
  const v = esquemaBorrador.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  if (d.renglones.length === 0) throw new ErrorDeUsuario('Cargá al menos un producto para dejar la venta abierta');
  const total = normalizarImporte(d.total || '0') ?? '0';
  return conTenant(s.tenantId, async (c) => {
    try {
      if (!id) {
        const r = await c.query<{ id: string; version: number }>(
          `INSERT INTO ventas_abiertas (tenant_id, cliente_id, datos, renglones, total, creada_por, modificada_por)
           VALUES (app.tenant_id(), $1, $2::jsonb, $3, $4, $5, $5) RETURNING id, version`, [d.clienteId, JSON.stringify(d), d.renglones.length, total, s.usuarioId]);
        await auditar(c, s.usuarioId, 'abrir', 'venta_abierta', { cliente: d.clienteId, renglones: d.renglones.length }, { entidadId: r.rows[0]!.id });
        return r.rows[0]!;
      }
      if (!UUID.test(id)) throw new ErrorDeUsuario('La venta abierta no existe');
      const r = await c.query<{ id: string; version: number }>(
        `UPDATE ventas_abiertas SET cliente_id = $2, datos = $3::jsonb, renglones = $4, total = $5, modificada_por = $6, modificado_en = now(), version = version + 1
          WHERE id = $1 AND estado = 'abierta' AND version = $7 RETURNING id, version`, [id, d.clienteId, JSON.stringify(d), d.renglones.length, total, s.usuarioId, version]);
      if (r.rows[0]) return r.rows[0];
      const e = await c.query<{ estado: string }>('SELECT estado FROM ventas_abiertas WHERE id = $1', [id]);
      if (!e.rows[0]) throw new ErrorDeUsuario('La venta abierta no existe');
      if (e.rows[0].estado !== 'abierta') throw new ErrorDeUsuario('Esta venta ya fue cerrada o descartada por otra persona');
      throw new ConflictoDeVersion('Otra persona modificó esta venta abierta mientras la editabas. Volvé a abrirla para ver los cambios.');
    } catch (e) {
      if ((e as { code?: string }).code === '23503') throw new ErrorDeUsuario('El cliente no existe');
      throw e;
    }
  });
}

/** Descarta una venta abierta (queda registrada como descartada, no se borra). */
export async function descartarAbierta(s: SesionActiva, id: string): Promise<void> {
  exigir(s, 'ventas');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La venta abierta no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ estado: string }>('SELECT estado FROM ventas_abiertas WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows[0]) throw new ErrorDeUsuario('La venta abierta no existe');
    if (r.rows[0].estado !== 'abierta') throw new ErrorDeUsuario('Esta venta ya fue cerrada o descartada');
    await c.query("UPDATE ventas_abiertas SET estado = 'descartada', modificada_por = $2, modificado_en = now() WHERE id = $1", [id, s.usuarioId]);
    await auditar(c, s.usuarioId, 'descartar', 'venta_abierta', {}, { entidadId: id });
  });
}
