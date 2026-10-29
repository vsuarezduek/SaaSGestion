// Recibos de cuenta corriente: el cliente paga lo que debe. Registrar un recibo es una sola transacción:
// el recibo, el ingreso en la caja (más la comisión del medio) y el movimiento que baja la deuda del cliente.
// Un recibo no se edita ni se borra: se anula generando los movimientos inversos.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { cajaEn } from './cajas.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaRecibo, primerError } from './validacion.ts';
import { aCentavos, comisionDeCobro, deCentavos } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResultadoRecibo { id: string; numero: number; importe: string; comision: string; repetido: boolean }

async function siguienteNumero(c: PoolClient): Promise<number> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':recibos'))");
  const r = await c.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM recibos');
  return r.rows[0]!.n;
}

export async function registrarRecibo(s: SesionActiva, entrada: unknown): Promise<ResultadoRecibo> {
  exigir(s, 'clientes');
  const v = esquemaRecibo.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  return conTenant(s.tenantId, async (c) => {
    // Doble clic o reintento: la misma clave devuelve el recibo ya registrado, sin duplicar nada.
    const previo = await c.query<{ id: string; numero: number; importe: string; comision: string }>('SELECT id, numero, importe::text, comision::text FROM recibos WHERE clave = $1', [d.clave]);
    if (previo.rows[0]) return { ...previo.rows[0], repetido: true };

    const cli = await c.query<{ activo: boolean; es_cf: boolean }>('SELECT activo, es_consumidor_final AS es_cf FROM clientes WHERE id = $1', [d.clienteId]);
    if (!cli.rows[0] || !cli.rows[0].activo) throw new ErrorDeUsuario('El cliente no existe o está archivado');
    if (cli.rows[0].es_cf) throw new ErrorDeUsuario('El Consumidor Final no tiene cuenta corriente');
    if (d.ventaId) {
      const vt = await c.query('SELECT 1 FROM ventas WHERE id = $1 AND cliente_id = $2', [d.ventaId, d.clienteId]);
      if (vt.rowCount === 0) throw new ErrorDeUsuario('La venta no existe o es de otro cliente');
    }
    const m = await c.query<{ comision_pct: string; iva_comision: string }>(
      `SELECT m.comision_pct::text, m.iva_comision::text FROM medios_pago m
        WHERE m.id = $1 AND m.activo AND EXISTS (SELECT 1 FROM medio_pago_cajas x WHERE x.medio_id = m.id AND x.caja_id = $2)`, [d.medioPagoId, d.cajaId]);
    if (!m.rows[0]) throw new ErrorDeUsuario('Ese medio de pago no está habilitado para esa caja');
    const caja = await cajaEn(c, s, d.cajaId);
    if (!caja.turnoId) throw new ErrorDeUsuario(`La caja ${caja.nombre} está cerrada: abrila para cobrar`);
    const comision = comisionDeCobro(aCentavos(d.importe), Number(m.rows[0].comision_pct), Number(m.rows[0].iva_comision));

    const numero = await siguienteNumero(c);
    const r = await c.query<{ id: string }>(
      `INSERT INTO recibos (tenant_id, numero, clave, cliente_id, venta_id, fecha, importe, medio_pago_id, caja_id, comision, nota, usuario_id)
       VALUES (app.tenant_id(), $1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7, $8, $9, $10, $11) RETURNING id`,
      [numero, d.clave, d.clienteId, d.ventaId, d.fecha, d.importe, d.medioPagoId, d.cajaId, deCentavos(comision), d.nota, s.usuarioId]);
    const id = r.rows[0]!.id;

    await c.query(
      `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, recibo_id, fecha)
       VALUES (app.tenant_id(), $1, $2, 'cobro_recibo', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
      [caja.id, caja.turnoId, d.importe, `Recibo N° ${numero}`, s.usuarioId, id, d.fecha]);
    if (comision > 0) {
      await c.query(
        `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, recibo_id, fecha)
         VALUES (app.tenant_id(), $1, $2, 'comision_recibo', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
        [caja.id, caja.turnoId, deCentavos(-comision), `Comisión recibo N° ${numero}`, s.usuarioId, id, d.fecha]);
    }
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, concepto, usuario_id, recibo_id)
       VALUES (app.tenant_id(), $1, 'recibo', $2, $3, $4, $5)`,
      [d.clienteId, '-' + d.importe, `Recibo N° ${numero}`, s.usuarioId, id]);

    await auditar(c, s.usuarioId, 'registrar', 'recibo', { numero, cliente: d.clienteId, importe: d.importe, venta: d.ventaId }, { entidadId: id });
    return { id, numero, importe: d.importe, comision: deCentavos(comision), repetido: false };
  });
}

/** Anula un recibo con motivo: revierte el ingreso (y la comisión) en la caja y devuelve la deuda al cliente. Todo o nada. */
export async function anularRecibo(s: SesionActiva, id: string, motivo: string): Promise<void> {
  exigir(s, 'clientes');
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw new ErrorDeUsuario('Indicá el motivo de la anulación');
  if (m.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  if (!UUID.test(id)) throw new ErrorDeUsuario('El recibo no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ numero: number; estado: string }>('SELECT numero, estado FROM recibos WHERE id = $1 FOR UPDATE', [id]);
    const rec = r.rows[0];
    if (!rec) throw new ErrorDeUsuario('El recibo no existe');
    if (rec.estado === 'anulado') throw new ErrorDeUsuario('El recibo ya está anulado');
    const concepto = `Anulación recibo N° ${rec.numero}`;
    await c.query(
      `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, revierte_id, usuario_id, recibo_id)
       SELECT app.tenant_id(), caja_id, NULL, 'reversion', -importe, $2, id, $3, recibo_id FROM caja_movimientos
        WHERE recibo_id = $1 AND tipo IN ('cobro_recibo', 'comision_recibo')`, [id, concepto, s.usuarioId]);
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id, recibo_id)
       SELECT app.tenant_id(), cliente_id, proveedor_id, 'reversion', -importe, $2, id, $3, recibo_id FROM cuenta_corriente_movimientos
        WHERE recibo_id = $1 AND tipo = 'recibo'`, [id, concepto, s.usuarioId]);
    await c.query(`UPDATE recibos SET estado = 'anulado', anulado_en = now(), anulado_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
    await auditar(c, s.usuarioId, 'anular', 'recibo', { numero: rec.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrado' } });
  });
}

export interface DetalleRecibo {
  id: string; numero: number; estado: string; fecha: Date; cliente: string; clienteId: string; importe: string; comision: string; cobro: string;
  nota: string | null; usuario: string | null; ventaId: string | null; ventaNumero: number | null; motivoAnulacion: string | null; anuladoEn: Date | null;
}

export async function obtenerRecibo(s: SesionActiva, id: string): Promise<DetalleRecibo | null> {
  exigir(s, 'clientes');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT r.*, r.importe::text AS importe_t, r.comision::text AS comision_t, c.nombre AS cliente, u.nombre AS usuario, v.numero AS venta_numero,
              COALESCE(m.nombre, '') || ' · ' || COALESCE(k.nombre, '') AS cobro
         FROM recibos r JOIN clientes c ON c.id = r.cliente_id LEFT JOIN usuarios u ON u.id = r.usuario_id LEFT JOIN ventas v ON v.id = r.venta_id
         LEFT JOIN medios_pago m ON m.id = r.medio_pago_id LEFT JOIN cajas k ON k.id = r.caja_id WHERE r.id = $1`, [id]);
    const f = r.rows[0];
    if (!f) return null;
    return {
      id: f.id, numero: f.numero, estado: f.estado, fecha: f.fecha, cliente: f.cliente, clienteId: f.cliente_id, importe: f.importe_t, comision: f.comision_t, cobro: f.cobro,
      nota: f.nota, usuario: f.usuario, ventaId: f.venta_id, ventaNumero: f.venta_numero, motivoAnulacion: f.motivo_anulacion, anuladoEn: f.anulado_en,
    };
  });
}
