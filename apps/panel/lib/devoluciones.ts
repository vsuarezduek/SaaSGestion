// Devolución de pago: se le devuelve plata a un cliente que tiene saldo a favor. Es una sola transacción:
// la devolución, el egreso de la caja y el movimiento que acerca a cero el saldo a favor del cliente.
// Una devolución no se edita ni se borra: se anula generando los movimientos inversos. No se puede devolver más que el saldo a favor.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { cajaEn } from './cajas.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaDevolucionPago, primerError } from './validacion.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResultadoDevolucion { id: string; numero: number; importe: string; repetida: boolean }

async function siguienteNumero(c: PoolClient): Promise<number> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':devoluciones'))");
  const r = await c.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM devoluciones_pago');
  return r.rows[0]!.n;
}

export async function registrarDevolucion(s: SesionActiva, entrada: unknown): Promise<ResultadoDevolucion> {
  exigir(s, 'clientes');
  const v = esquemaDevolucionPago.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  return conTenant(s.tenantId, async (c) => {
    // Doble clic o reintento: la misma clave devuelve la devolución ya registrada, sin duplicar nada.
    const previa = await c.query<{ id: string; numero: number; importe: string }>('SELECT id, numero, importe::text FROM devoluciones_pago WHERE clave = $1', [d.clave]);
    if (previa.rows[0]) return { ...previa.rows[0], repetida: true };

    // Se bloquea al cliente: dos devoluciones a la vez no pueden pasarse del saldo a favor.
    const cli = await c.query<{ activo: boolean; es_cf: boolean }>('SELECT activo, es_consumidor_final AS es_cf FROM clientes WHERE id = $1 FOR UPDATE', [d.clienteId]);
    if (!cli.rows[0] || !cli.rows[0].activo) throw new ErrorDeUsuario('El cliente no existe o está archivado');
    if (cli.rows[0].es_cf) throw new ErrorDeUsuario('El Consumidor Final no tiene cuenta corriente');
    const sal = await c.query<{ saldo: string; excede: boolean }>(
      `SELECT COALESCE(sum(importe), 0)::numeric(14,2)::text AS saldo, $2::numeric > -COALESCE(sum(importe), 0) AS excede
         FROM cuenta_corriente_movimientos WHERE cliente_id = $1`, [d.clienteId, d.importe]);
    if (Number(sal.rows[0]!.saldo) >= 0) throw new ErrorDeUsuario('Este cliente no tiene saldo a favor para devolver');
    if (sal.rows[0]!.excede) throw new ErrorDeUsuario(`Solo se puede devolver hasta el saldo a favor del cliente ($ ${sal.rows[0]!.saldo.replace('-', '')})`);

    const m = await c.query(
      `SELECT 1 FROM medios_pago m WHERE m.id = $1 AND m.activo AND EXISTS (SELECT 1 FROM medio_pago_cajas x WHERE x.medio_id = m.id AND x.caja_id = $2)`, [d.medioPagoId, d.cajaId]);
    if (m.rowCount === 0) throw new ErrorDeUsuario('Ese medio de pago no está habilitado para esa caja');
    const caja = await cajaEn(c, s, d.cajaId);
    if (!caja.turnoId) throw new ErrorDeUsuario(`La caja ${caja.nombre} está cerrada: abrila para devolver el dinero`);

    const numero = await siguienteNumero(c);
    const r = await c.query<{ id: string }>(
      `INSERT INTO devoluciones_pago (tenant_id, numero, clave, cliente_id, fecha, importe, medio_pago_id, caja_id, nota, usuario_id)
       VALUES (app.tenant_id(), $1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6, $7, $8, $9) RETURNING id`,
      [numero, d.clave, d.clienteId, d.fecha, d.importe, d.medioPagoId, d.cajaId, d.nota, s.usuarioId]);
    const id = r.rows[0]!.id;
    await c.query(
      `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, devolucion_id, fecha)
       VALUES (app.tenant_id(), $1, $2, 'devolucion_pago', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
      [caja.id, caja.turnoId, '-' + d.importe, `Devolución de pago N° ${numero}`, s.usuarioId, id, d.fecha]);
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, concepto, usuario_id, devolucion_id)
       VALUES (app.tenant_id(), $1, 'devolucion_pago', $2, $3, $4, $5)`,
      [d.clienteId, d.importe, `Devolución de pago N° ${numero}`, s.usuarioId, id]);
    await auditar(c, s.usuarioId, 'registrar', 'devolucion_pago', { numero, cliente: d.clienteId, importe: d.importe }, { entidadId: id });
    return { id, numero, importe: d.importe, repetida: false };
  });
}

/** Anula una devolución con motivo: la plata vuelve a la caja y el saldo a favor vuelve al cliente. Todo o nada. */
export async function anularDevolucion(s: SesionActiva, id: string, motivo: string): Promise<void> {
  exigir(s, 'clientes');
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw new ErrorDeUsuario('Indicá el motivo de la anulación');
  if (m.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La devolución no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ numero: number; estado: string }>('SELECT numero, estado FROM devoluciones_pago WHERE id = $1 FOR UPDATE', [id]);
    const dev = r.rows[0];
    if (!dev) throw new ErrorDeUsuario('La devolución no existe');
    if (dev.estado === 'anulada') throw new ErrorDeUsuario('La devolución ya está anulada');
    const concepto = `Anulación devolución de pago N° ${dev.numero}`;
    await c.query(
      `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, revierte_id, usuario_id, devolucion_id)
       SELECT app.tenant_id(), caja_id, NULL, 'reversion', -importe, $2, id, $3, devolucion_id FROM caja_movimientos WHERE devolucion_id = $1 AND tipo = 'devolucion_pago'`, [id, concepto, s.usuarioId]);
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id, devolucion_id)
       SELECT app.tenant_id(), cliente_id, proveedor_id, 'reversion', -importe, $2, id, $3, devolucion_id FROM cuenta_corriente_movimientos WHERE devolucion_id = $1 AND tipo = 'devolucion_pago'`, [id, concepto, s.usuarioId]);
    await c.query(`UPDATE devoluciones_pago SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
    await auditar(c, s.usuarioId, 'anular', 'devolucion_pago', { numero: dev.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrada' } });
  });
}

export interface DetalleDevolucion {
  id: string; numero: number; estado: string; fecha: Date; cliente: string; clienteId: string; importe: string; cobro: string;
  nota: string | null; usuario: string | null; motivoAnulacion: string | null; anuladaEn: Date | null;
}

export async function obtenerDevolucion(s: SesionActiva, id: string): Promise<DetalleDevolucion | null> {
  exigir(s, 'clientes');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT d.*, d.importe::text AS importe_t, c.nombre AS cliente, u.nombre AS usuario, COALESCE(m.nombre, '') || ' · ' || COALESCE(k.nombre, '') AS cobro
         FROM devoluciones_pago d JOIN clientes c ON c.id = d.cliente_id LEFT JOIN usuarios u ON u.id = d.usuario_id
         LEFT JOIN medios_pago m ON m.id = d.medio_pago_id LEFT JOIN cajas k ON k.id = d.caja_id WHERE d.id = $1`, [id]);
    const f = r.rows[0];
    if (!f) return null;
    return { id: f.id, numero: f.numero, estado: f.estado, fecha: f.fecha, cliente: f.cliente, clienteId: f.cliente_id, importe: f.importe_t, cobro: f.cobro, nota: f.nota, usuario: f.usuario, motivoAnulacion: f.motivo_anulacion, anuladaEn: f.anulada_en };
  });
}
