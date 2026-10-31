// Órdenes de pago a proveedores: se le paga (total o parcialmente) lo que se le debe. Registrar una orden es una sola transacción:
// la orden, el egreso en la caja (más el impuesto por transacción de esa caja) y el movimiento que baja la deuda con el proveedor.
// Una orden no se edita ni se borra: se anula generando los movimientos inversos.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { cajaEn } from './cajas.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaOrdenPago, primerError } from './validacion.ts';
import { aCentavos, deCentavos, impuestoDeTransaccion } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResultadoOrdenPago { id: string; numero: number; importe: string; impuesto: string; repetida: boolean }

async function siguienteNumero(c: PoolClient): Promise<number> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':ordenes_pago'))");
  const r = await c.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM ordenes_pago');
  return r.rows[0]!.n;
}

export async function registrarOrdenPago(s: SesionActiva, entrada: unknown): Promise<ResultadoOrdenPago> {
  exigir(s, 'proveedores');
  const v = esquemaOrdenPago.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  return conTenant(s.tenantId, async (c) => {
    // Doble clic o reintento: la misma clave devuelve la orden ya registrada, sin duplicar nada.
    const previa = await c.query<{ id: string; numero: number; importe: string; impuesto: string }>('SELECT id, numero, importe::text, impuesto::text FROM ordenes_pago WHERE clave = $1', [d.clave]);
    if (previa.rows[0]) return { ...previa.rows[0], repetida: true };

    const prov = await c.query<{ activo: boolean }>('SELECT activo FROM proveedores WHERE id = $1', [d.proveedorId]);
    if (!prov.rows[0] || !prov.rows[0].activo) throw new ErrorDeUsuario('El proveedor no existe o está archivado');
    if (d.compraId) {
      const cp = await c.query('SELECT 1 FROM compras WHERE id = $1 AND proveedor_id = $2 AND estado = $3', [d.compraId, d.proveedorId, 'cerrada']);
      if (cp.rowCount === 0) throw new ErrorDeUsuario('La compra no existe, está anulada o es de otro proveedor');
    }
    const caja = await cajaEn(c, s, d.cajaId);
    if (!caja.turnoId) throw new ErrorDeUsuario(`La caja ${caja.nombre} está cerrada: abrila para pagar desde ahí`);
    const impuesto = impuestoDeTransaccion(aCentavos(d.importe), caja.impuestoTransaccion);

    const numero = await siguienteNumero(c);
    const r = await c.query<{ id: string }>(
      `INSERT INTO ordenes_pago (tenant_id, numero, clave, proveedor_id, compra_id, fecha, importe, caja_id, impuesto, nota, usuario_id)
       VALUES (app.tenant_id(), $1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7, $8, $9, $10) RETURNING id`,
      [numero, d.clave, d.proveedorId, d.compraId, d.fecha, d.importe, d.cajaId, deCentavos(impuesto), d.nota, s.usuarioId]);
    const id = r.rows[0]!.id;

    await c.query(
      `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, orden_pago_id, fecha)
       VALUES (app.tenant_id(), $1, $2, 'pago_orden', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
      [caja.id, caja.turnoId, '-' + d.importe, `Orden de pago N° ${numero}`, s.usuarioId, id, d.fecha]);
    if (impuesto > 0) {
      await c.query(
        `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, orden_pago_id, fecha)
         VALUES (app.tenant_id(), $1, $2, 'impuesto_orden', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
        [caja.id, caja.turnoId, deCentavos(-impuesto), `Impuesto por transacción ${caja.impuestoTransaccion}% · orden de pago N° ${numero}`, s.usuarioId, id, d.fecha]);
    }
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, proveedor_id, tipo, importe, concepto, usuario_id, orden_pago_id)
       VALUES (app.tenant_id(), $1, 'orden_pago', $2, $3, $4, $5)`,
      [d.proveedorId, '-' + d.importe, `Orden de pago N° ${numero}`, s.usuarioId, id]);

    await auditar(c, s.usuarioId, 'registrar', 'orden_pago', { numero, proveedor: d.proveedorId, importe: d.importe, compra: d.compraId }, { entidadId: id });
    return { id, numero, importe: d.importe, impuesto: deCentavos(impuesto), repetida: false };
  });
}

/** Anula una orden de pago con motivo: devuelve el dinero (y el impuesto) a la caja y la deuda al proveedor. Todo o nada. */
export async function anularOrdenPago(s: SesionActiva, id: string, motivo: string): Promise<void> {
  exigir(s, 'proveedores');
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw new ErrorDeUsuario('Indicá el motivo de la anulación');
  if (m.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La orden de pago no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ numero: number; estado: string }>('SELECT numero, estado FROM ordenes_pago WHERE id = $1 FOR UPDATE', [id]);
    const op = r.rows[0];
    if (!op) throw new ErrorDeUsuario('La orden de pago no existe');
    if (op.estado === 'anulada') throw new ErrorDeUsuario('La orden de pago ya está anulada');
    const concepto = `Anulación orden de pago N° ${op.numero}`;
    await c.query(
      `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, revierte_id, usuario_id, orden_pago_id)
       SELECT app.tenant_id(), caja_id, NULL, 'reversion', -importe, $2, id, $3, orden_pago_id FROM caja_movimientos
        WHERE orden_pago_id = $1 AND tipo IN ('pago_orden', 'impuesto_orden')`, [id, concepto, s.usuarioId]);
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id, orden_pago_id)
       SELECT app.tenant_id(), cliente_id, proveedor_id, 'reversion', -importe, $2, id, $3, orden_pago_id FROM cuenta_corriente_movimientos
        WHERE orden_pago_id = $1 AND tipo = 'orden_pago'`, [id, concepto, s.usuarioId]);
    await c.query(`UPDATE ordenes_pago SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
    await auditar(c, s.usuarioId, 'anular', 'orden_pago', { numero: op.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrada' } });
  });
}

export interface DetalleOrdenPago {
  id: string; numero: number; estado: string; fecha: Date; proveedor: string; proveedorId: string; importe: string; impuesto: string; caja: string;
  nota: string | null; usuario: string | null; compraId: string | null; compraNumero: number | null; motivoAnulacion: string | null; anuladaEn: Date | null;
}

export async function obtenerOrdenPago(s: SesionActiva, id: string): Promise<DetalleOrdenPago | null> {
  exigir(s, 'proveedores');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT o.*, o.importe::text AS importe_t, o.impuesto::text AS impuesto_t, p.nombre AS proveedor, u.nombre AS usuario, cp.numero AS compra_numero, k.nombre AS caja
         FROM ordenes_pago o JOIN proveedores p ON p.id = o.proveedor_id LEFT JOIN usuarios u ON u.id = o.usuario_id LEFT JOIN compras cp ON cp.id = o.compra_id
         LEFT JOIN cajas k ON k.id = o.caja_id WHERE o.id = $1`, [id]);
    const f = r.rows[0];
    if (!f) return null;
    return {
      id: f.id, numero: f.numero, estado: f.estado, fecha: f.fecha, proveedor: f.proveedor, proveedorId: f.proveedor_id, importe: f.importe_t, impuesto: f.impuesto_t, caja: f.caja ?? '',
      nota: f.nota, usuario: f.usuario, compraId: f.compra_id, compraNumero: f.compra_numero, motivoAnulacion: f.motivo_anulacion, anuladaEn: f.anulada_en,
    };
  });
}
