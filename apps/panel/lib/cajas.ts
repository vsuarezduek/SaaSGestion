// Cajas: turnos (apertura/cierre con arqueo) y libro de movimientos de solo agregar.
// El saldo es la suma de movimientos. Caja cerrada = bloqueada (la base lo garantiza además de esta capa).
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { ErrorDePermiso, exigir } from './permisos.ts';
import {
  esquemaApertura, esquemaCaja, esquemaCierre, esquemaMovimientoCaja, esquemaTransferencia, primerError,
} from './validacion.ts';
import { aCentavos, deCentavos } from '../../../packages/dominio/src/index.ts';
import { puedeVerCaja, type Rol } from '../../../packages/seguridad/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALDO_SQL = '(SELECT COALESCE(sum(m.importe), 0)::numeric(14,2) FROM caja_movimientos m WHERE m.caja_id = c.id)';

export interface Caja {
  id: string; nombre: string; tipo: 'efectivo' | 'digital'; impuestoTransaccion: number; activa: boolean;
  abierta: boolean; saldo: string; turnoId: string | null;
}

/** Cajas que esta persona puede ver (cajas_visibles del usuario; el administrador ve todas). */
async function visibles(c: PoolClient, s: SesionActiva): Promise<(id: string) => boolean> {
  const r = await c.query<{ cajas_visibles: string[] | null }>('SELECT cajas_visibles FROM usuarios WHERE id = $1', [s.usuarioId]);
  const u = { rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: r.rows[0]?.cajas_visibles ?? null };
  return (id) => puedeVerCaja(u, id);
}

function mapCaja(f: { id: string; nombre: string; tipo: 'efectivo' | 'digital'; impuesto_transaccion: string; activa: boolean; saldo: string; turno_id: string | null }): Caja {
  return { id: f.id, nombre: f.nombre, tipo: f.tipo, impuestoTransaccion: Number(f.impuesto_transaccion), activa: f.activa, abierta: f.turno_id !== null, saldo: f.saldo, turnoId: f.turno_id };
}

export async function cajaEn(c: PoolClient, s: SesionActiva, id: string): Promise<Caja> {
  const r = await c.query(
    `SELECT c.id, c.nombre, c.tipo, c.impuesto_transaccion::text, c.activa, ${SALDO_SQL}::text AS saldo,
            (SELECT t.id FROM caja_turnos t WHERE t.caja_id = c.id AND t.cerrado_en IS NULL) AS turno_id
       FROM cajas c WHERE c.id = $1`,
    [id],
  );
  if (!r.rows[0] || !(await visibles(c, s))(id)) throw new ErrorDeUsuario('La caja no existe');
  return mapCaja(r.rows[0]);
}

export async function listarCajas(s: SesionActiva): Promise<Caja[]> {
  exigir(s, 'cajas');
  return conTenant(s.tenantId, async (c) => {
    const ok = await visibles(c, s);
    const r = await c.query(
      `SELECT c.id, c.nombre, c.tipo, c.impuesto_transaccion::text, c.activa, ${SALDO_SQL}::text AS saldo,
              (SELECT t.id FROM caja_turnos t WHERE t.caja_id = c.id AND t.cerrado_en IS NULL) AS turno_id
         FROM cajas c WHERE c.activa ORDER BY c.orden, lower(c.nombre)`,
    );
    return r.rows.filter((f) => ok(f.id)).map(mapCaja);
  });
}

export async function obtenerCaja(s: SesionActiva, id: string): Promise<Caja | null> {
  exigir(s, 'cajas');
  if (!UUID.test(id)) return null;
  try {
    return await conTenant(s.tenantId, (c) => cajaEn(c, s, id));
  } catch (e) {
    if (e instanceof ErrorDeUsuario) return null;
    throw e;
  }
}

// ───────── Configuración (requiere permiso de ajustes) ─────────
export async function guardarCaja(s: SesionActiva, id: string | null, entrada: unknown): Promise<string> {
  exigir(s, 'ajustes');
  const v = esquemaCaja.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  try {
    return await conTenant(s.tenantId, async (c) => {
      let cid = id;
      let antes: unknown = null;
      if (id) {
        const a = await c.query('SELECT nombre, tipo, impuesto_transaccion::text FROM cajas WHERE id = $1', [id]);
        if (!a.rows[0]) throw new ErrorDeUsuario('La caja no existe');
        antes = a.rows[0];
        await c.query('UPDATE cajas SET nombre=$2, tipo=$3, impuesto_transaccion=$4 WHERE id=$1', [id, d.nombre, d.tipo, d.impuestoTransaccion]);
      } else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO cajas (tenant_id, nombre, tipo, impuesto_transaccion, orden)
           VALUES (app.tenant_id(), $1, $2, $3, (SELECT COALESCE(max(orden), 0) + 1 FROM cajas)) RETURNING id`,
          [d.nombre, d.tipo, d.impuestoTransaccion],
        );
        cid = r.rows[0]!.id;
      }
      await auditar(c, s.usuarioId, id ? 'modificar' : 'crear', 'caja', d, { entidadId: cid!, antes });
      return cid!;
    });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) throw e;
    if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ya hay una caja con ese nombre');
    throw e;
  }
}

/** Todas las cajas, también las archivadas, para la pantalla de ajustes. */
export async function listarCajasParaAjustes(s: SesionActiva): Promise<Caja[]> {
  exigir(s, 'ajustes');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT c.id, c.nombre, c.tipo, c.impuesto_transaccion::text, c.activa, ${SALDO_SQL}::text AS saldo,
              (SELECT t.id FROM caja_turnos t WHERE t.caja_id = c.id AND t.cerrado_en IS NULL) AS turno_id
         FROM cajas c ORDER BY c.activa DESC, c.orden, lower(c.nombre)`);
    return r.rows.map(mapCaja);
  });
}

/** Archiva o reactiva una caja. Para archivarla tiene que estar cerrada y sin saldo (no se borra: sus movimientos quedan). */
export async function cambiarEstadoCaja(s: SesionActiva, id: string, activa: boolean): Promise<void> {
  exigir(s, 'ajustes');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La caja no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ activa: boolean; saldo: string; abierta: boolean }>(
      `SELECT c.activa, ${SALDO_SQL}::text AS saldo, EXISTS (SELECT 1 FROM caja_turnos t WHERE t.caja_id = c.id AND t.cerrado_en IS NULL) AS abierta FROM cajas c WHERE c.id = $1 FOR UPDATE`, [id]);
    const k = r.rows[0];
    if (!k) throw new ErrorDeUsuario('La caja no existe');
    if (k.activa === activa) return;
    if (!activa) {
      if (k.abierta) throw new ErrorDeUsuario('Cerrá la caja antes de archivarla');
      if (aCentavos(k.saldo) !== 0) throw new ErrorDeUsuario('La caja todavía tiene saldo: transferilo a otra caja antes de archivarla');
    }
    await c.query('UPDATE cajas SET activa = $2 WHERE id = $1', [id, activa]);
    await auditar(c, s.usuarioId, activa ? 'reactivar' : 'archivar', 'caja', undefined, { entidadId: id });
  });
}

/** Sube o baja una caja en el orden en que se muestran. */
export async function moverCaja(s: SesionActiva, id: string, direccion: 'arriba' | 'abajo'): Promise<void> {
  exigir(s, 'ajustes');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La caja no existe');
  await conTenant(s.tenantId, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':orden_cajas'))");
    const r = await c.query<{ id: string }>('SELECT id FROM cajas WHERE activa ORDER BY orden, lower(nombre), id');
    const ids = r.rows.map((f) => f.id);
    const i = ids.indexOf(id);
    if (i < 0) throw new ErrorDeUsuario('La caja no existe o está archivada');
    const j = direccion === 'arriba' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    for (let k = 0; k < ids.length; k++) await c.query('UPDATE cajas SET orden = $2 WHERE id = $1', [ids[k], k + 1]);
    await auditar(c, s.usuarioId, 'modificar', 'caja', { orden: direccion }, { entidadId: id });
  });
}

// ───────── Movimientos ─────────
export interface MovimientoCaja {
  id: string; tipo: string; importe: string; concepto: string | null; fecha: Date; usuario: string | null; revertido: boolean; revierteId: string | null; enTransferencia: boolean; origen: string | null;
}

export async function movimientosDeCaja(s: SesionActiva, cajaId: string, limite = 10): Promise<MovimientoCaja[]> {
  exigir(s, 'cajas');
  return conTenant(s.tenantId, async (c) => {
    await cajaEn(c, s, cajaId);
    // El administrador ve los movimientos de todos; los demás, solo los suyos.
    const soloPropios = s.rol !== 'administrador';
    const r = await c.query(
      `SELECT m.id::text, m.tipo, m.importe::text, m.concepto, m.fecha, u.nombre AS usuario, m.revierte_id::text, m.grupo_id IS NOT NULL AS en_transferencia, m.venta_id, m.recibo_id, m.devolucion_id, m.compra_id, m.orden_pago_id,
              EXISTS (SELECT 1 FROM caja_movimientos x WHERE x.revierte_id = m.id) AS revertido
         FROM caja_movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.caja_id = $1 ${soloPropios ? 'AND m.usuario_id = $2' : ''}
        ORDER BY m.fecha DESC, m.id DESC LIMIT ${Math.min(Math.max(limite, 1), 500)}`,
      soloPropios ? [cajaId, s.usuarioId] : [cajaId],
    );
    return r.rows.map((f) => ({ id: f.id, tipo: f.tipo, importe: f.importe, concepto: f.concepto, fecha: f.fecha, usuario: f.usuario, revertido: f.revertido, revierteId: f.revierte_id, enTransferencia: f.en_transferencia, origen: enlaceDeOrigen(f) }));
  });
}

async function insertar(c: PoolClient, s: SesionActiva, caja: Caja, tipo: string, importe: string, concepto: string | null, extra: { grupo?: string; fecha?: string | null } = {}): Promise<string> {
  if (!caja.turnoId) throw new ErrorDeUsuario(`La caja ${caja.nombre} está cerrada`);
  const r = await c.query<{ id: string }>(
    `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, grupo_id, usuario_id, fecha)
     VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now())) RETURNING id::text`,
    [caja.id, caja.turnoId, tipo, importe, concepto, extra.grupo ?? null, s.usuarioId, extra.fecha ?? null],
  );
  return r.rows[0]!.id;
}

const neg = (n: string): string => deCentavos(-aCentavos(n));

/** A qué pantalla lleva un movimiento según de dónde vino (venta, recibo, devolución, compra u orden de pago). */
function enlaceDeOrigen(f: { venta_id: string | null; recibo_id: string | null; devolucion_id: string | null; compra_id: string | null; orden_pago_id: string | null }): string | null {
  if (f.venta_id) return `/ventas/${f.venta_id}`;
  if (f.recibo_id) return `/recibos/${f.recibo_id}`;
  if (f.devolucion_id) return `/devoluciones/${f.devolucion_id}`;
  if (f.compra_id) return `/compras/${f.compra_id}`;
  if (f.orden_pago_id) return `/ordenes-pago/${f.orden_pago_id}`;
  return null;
}

/** Ingreso o egreso manual. La caja tiene que estar abierta. */
export async function movimientoManual(s: SesionActiva, cajaId: string, entrada: unknown): Promise<string> {
  exigir(s, 'cajas');
  const v = esquemaMovimientoCaja.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  return conTenant(s.tenantId, async (c) => {
    const caja = await cajaEn(c, s, cajaId);
    const importe = v.data.tipo === 'egreso' ? neg(v.data.importe) : v.data.importe;
    const id = await insertar(c, s, caja, v.data.tipo, importe, v.data.concepto, { fecha: v.data.fecha });
    await auditar(c, s.usuarioId, 'movimiento', 'caja', { cajaId, ...v.data }, { entidadId: id });
    return id;
  });
}

/** Transferencia entre dos cajas abiertas: dos movimientos unidos por el mismo grupo. */
export async function transferir(s: SesionActiva, entrada: unknown): Promise<string> {
  exigir(s, 'cajas');
  const v = esquemaTransferencia.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const { origenId, destinoId, concepto } = v.data;
  if (origenId === destinoId) throw new ErrorDeUsuario('Elegí dos cajas distintas');
  return conTenant(s.tenantId, async (c) => {
    const [origen, destino] = [await cajaEn(c, s, origenId), await cajaEn(c, s, destinoId)];
    const importe = v.data.importe ?? origen.saldo;
    if (aCentavos(importe) <= 0) throw new ErrorDeUsuario('No hay saldo para transferir');
    const grupo = randomUUID();
    const texto = concepto ?? 'Transferencia';
    await insertar(c, s, origen, 'transferencia_salida', neg(importe), `${texto} → ${destino.nombre}`, { grupo });
    const id = await insertar(c, s, destino, 'transferencia_entrada', importe, `${texto} ← ${origen.nombre}`, { grupo });
    await auditar(c, s.usuarioId, 'transferir', 'caja', { origenId, destinoId, importe }, { entidadId: grupo });
    return id;
  });
}

/** Anula un movimiento generando el inverso (y el de la otra caja si era una transferencia). Se permite aunque la caja esté cerrada. */
export async function revertirMovimientoCaja(s: SesionActiva, cajaId: string, movimientoId: string): Promise<void> {
  exigir(s, 'cajas');
  if (!/^\d+$/.test(movimientoId)) throw new ErrorDeUsuario('El movimiento no existe');
  await conTenant(s.tenantId, async (c) => {
    await cajaEn(c, s, cajaId);
    const o = await c.query<{ id: string; caja_id: string; tipo: string; importe: string; grupo_id: string | null }>(
      'SELECT id::text, caja_id, tipo, importe::text, grupo_id FROM caja_movimientos WHERE id = $1 AND caja_id = $2', [movimientoId, cajaId]);
    const orig = o.rows[0];
    if (!orig) throw new ErrorDeUsuario('El movimiento no existe');
    if (orig.tipo === 'reversion') throw new ErrorDeUsuario('Una anulación no se puede anular');
    const conjunto = orig.grupo_id
      ? (await c.query<{ id: string; caja_id: string; importe: string }>('SELECT id::text, caja_id, importe::text FROM caja_movimientos WHERE grupo_id = $1', [orig.grupo_id])).rows
      : [orig];
    try {
      for (const m of conjunto) {
        await c.query(
          `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, grupo_id, revierte_id, usuario_id)
           VALUES (app.tenant_id(), $1, NULL, 'reversion', $2, 'Anulación', NULL, $3, $4)`,
          [m.caja_id, neg(m.importe), m.id, s.usuarioId]);
      }
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ese movimiento ya fue anulado');
      throw e;
    }
    await auditar(c, s.usuarioId, 'anular', 'caja', { movimiento: movimientoId }, { entidadId: movimientoId });
  });
}

// ───────── Apertura y cierre ─────────
/** Abre la caja contando lo que hay; si difiere del saldo esperado, la diferencia queda registrada. */
export async function abrirCaja(s: SesionActiva, cajaId: string, entrada: unknown): Promise<void> {
  exigir(s, 'cajas');
  const v = esquemaApertura.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  await conTenant(s.tenantId, async (c) => {
    const caja = await cajaEn(c, s, cajaId);
    if (caja.turnoId) throw new ErrorDeUsuario('La caja ya está abierta');
    const t = await c.query<{ id: string }>(
      `INSERT INTO caja_turnos (tenant_id, caja_id, abierto_por, apertura_esperada, apertura_contada)
       VALUES (app.tenant_id(), $1, $2, $3, $4) RETURNING id`,
      [cajaId, s.usuarioId, caja.saldo, v.data.contado],
    );
    const dif = aCentavos(v.data.contado) - aCentavos(caja.saldo);
    if (dif !== 0) await insertar(c, s, { ...caja, turnoId: t.rows[0]!.id }, 'apertura_diferencia', deCentavos(dif), 'Diferencia en la apertura');
    await auditar(c, s.usuarioId, 'abrir', 'caja', { contado: v.data.contado, esperado: caja.saldo }, { entidadId: cajaId });
  });
}

export interface ResumenTurno { ingresos: string; egresos: string; movimientos: number; apertura: string }

export async function resumenDelTurno(s: SesionActiva, cajaId: string): Promise<ResumenTurno | null> {
  exigir(s, 'cajas');
  return conTenant(s.tenantId, async (c) => {
    const caja = await cajaEn(c, s, cajaId);
    if (!caja.turnoId) return null;
    const r = await c.query(
      `SELECT COALESCE(sum(importe) FILTER (WHERE importe > 0), 0)::text AS ingresos, COALESCE(-sum(importe) FILTER (WHERE importe < 0), 0)::text AS egresos,
              count(*)::int AS n, (SELECT apertura_contada::text FROM caja_turnos WHERE id = $1) AS apertura
         FROM caja_movimientos WHERE turno_id = $1`, [caja.turnoId]);
    const f = r.rows[0];
    return { ingresos: f.ingresos, egresos: f.egresos, movimientos: f.n, apertura: f.apertura };
  });
}

/**
 * Cierre con arqueo: diferencia = contado − esperado (si ≠ 0 queda como movimiento);
 * traspaso = contado − cambio dejado, si hay caja destino (que debe estar abierta).
 */
export async function cerrarCaja(s: SesionActiva, cajaId: string, entrada: unknown): Promise<void> {
  exigir(s, 'cajas');
  const v = esquemaCierre.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const { contado, cambioDejado, destinoId } = v.data;
  await conTenant(s.tenantId, async (c) => {
    const caja = await cajaEn(c, s, cajaId);
    if (!caja.turnoId) throw new ErrorDeUsuario('La caja ya está cerrada');
    if (aCentavos(cambioDejado) > aCentavos(contado)) throw new ErrorDeUsuario('El cambio que se deja no puede superar lo contado');
    if (destinoId === cajaId) throw new ErrorDeUsuario('Elegí otra caja como destino del traspaso');
    const destino = destinoId ? await cajaEn(c, s, destinoId) : null;
    if (destino && !destino.turnoId) throw new ErrorDeUsuario(`La caja ${destino.nombre} está cerrada: abrila para traspasar`);
    await c.query('SELECT 1 FROM caja_turnos WHERE id = $1 FOR UPDATE', [caja.turnoId]);

    const esperado = caja.saldo;
    const dif = aCentavos(contado) - aCentavos(esperado);
    if (dif !== 0) await insertar(c, s, caja, 'cierre_diferencia', deCentavos(dif), dif > 0 ? 'Sobrante en el cierre' : 'Faltante en el cierre');
    const traspaso = destino ? aCentavos(contado) - aCentavos(cambioDejado) : 0;
    if (destino && traspaso > 0) {
      const grupo = randomUUID();
      await insertar(c, s, caja, 'traspaso_salida', deCentavos(-traspaso), `Traspaso → ${destino.nombre}`, { grupo });
      await insertar(c, s, destino, 'traspaso_entrada', deCentavos(traspaso), `Traspaso ← ${caja.nombre}`, { grupo });
    }
    await c.query(
      `UPDATE caja_turnos SET cerrado_en = now(), cerrado_por = $2, cierre_esperado = $3, cierre_contado = $4, cambio_dejado = $5,
              traspaso_caja_id = $6, traspaso_importe = $7 WHERE id = $1`,
      [caja.turnoId, s.usuarioId, esperado, contado, cambioDejado, traspaso > 0 ? destino!.id : null, traspaso > 0 ? deCentavos(traspaso) : null],
    );
    await auditar(c, s.usuarioId, 'cerrar', 'caja', { esperado, contado, diferencia: deCentavos(dif), cambioDejado, traspaso: deCentavos(traspaso) }, { entidadId: cajaId });
  });
}

export interface Cierre {
  id: string; caja: string; cajaId: string; abiertoEn: Date; cerradoEn: Date; esperado: string; contado: string; diferencia: string; cambioDejado: string; traspaso: string | null; destino: string | null; usuario: string | null;
}

/** Historial de cierres, de una caja o de todas las que puede ver. */
export async function historialDeCierres(s: SesionActiva, cajaId?: string, limite = 20): Promise<Cierre[]> {
  exigir(s, 'cajas');
  return conTenant(s.tenantId, async (c) => {
    const ok = await visibles(c, s);
    const r = await c.query(
      `SELECT t.id, k.nombre AS caja, t.caja_id, t.abierto_en, t.cerrado_en, t.cierre_esperado::text AS esperado, t.cierre_contado::text AS contado,
              (t.cierre_contado - t.cierre_esperado)::text AS diferencia, COALESCE(t.cambio_dejado, 0)::text AS cambio, t.traspaso_importe::text AS traspaso,
              d.nombre AS destino, u.nombre AS usuario
         FROM caja_turnos t JOIN cajas k ON k.id = t.caja_id LEFT JOIN cajas d ON d.id = t.traspaso_caja_id LEFT JOIN usuarios u ON u.id = t.cerrado_por
        WHERE t.cerrado_en IS NOT NULL ${cajaId && UUID.test(cajaId) ? 'AND t.caja_id = $1' : ''}
        ORDER BY t.cerrado_en DESC LIMIT ${Math.min(Math.max(limite, 1), 200)}`,
      cajaId && UUID.test(cajaId) ? [cajaId] : [],
    );
    return r.rows.filter((f) => ok(f.caja_id)).map((f) => ({
      id: f.id, caja: f.caja, cajaId: f.caja_id, abiertoEn: f.abierto_en, cerradoEn: f.cerrado_en, esperado: f.esperado, contado: f.contado,
      diferencia: f.diferencia, cambioDejado: f.cambio, traspaso: f.traspaso, destino: f.destino, usuario: f.usuario,
    }));
  });
}

// ───────── Detalle de un cierre y reapertura ─────────
export interface MovimientoDeTurno { id: string; tipo: string; importe: string; concepto: string | null; fecha: Date; usuario: string | null; revertido: boolean; origen: string | null }
export interface DetalleCierre extends Cierre {
  abiertoPor: string | null; aperturaEsperada: string; aperturaContada: string; cierreEsperado: string; cierreContado: string;
  reabreTurnoId: string | null; reaperturaMotivo: string | null; reabiertoPor: string | null; reabierto: boolean;
  ingresos: string; egresos: string; movimientos: MovimientoDeTurno[];
}

/** Todo lo que pasó en un turno cerrado: arqueo de apertura y cierre, totales y cada movimiento. */
export async function detalleDeCierre(s: SesionActiva, turnoId: string): Promise<DetalleCierre | null> {
  exigir(s, 'cajas');
  if (!UUID.test(turnoId)) return null;
  return conTenant(s.tenantId, async (c) => {
    const ok = await visibles(c, s);
    const r = await c.query(
      `SELECT t.id, k.nombre AS caja, t.caja_id, t.abierto_en, t.cerrado_en, t.apertura_esperada::text AS ap_esp, t.apertura_contada::text AS ap_con,
              t.cierre_esperado::text AS esperado, t.cierre_contado::text AS contado, (t.cierre_contado - t.cierre_esperado)::text AS diferencia,
              COALESCE(t.cambio_dejado, 0)::text AS cambio, t.traspaso_importe::text AS traspaso, d.nombre AS destino, u.nombre AS usuario, ua.nombre AS abierto_por,
              t.reabre_turno_id, t.reapertura_motivo,
              (SELECT x.id FROM caja_turnos x WHERE x.reabre_turno_id = t.id) AS reabierto_id
         FROM caja_turnos t JOIN cajas k ON k.id = t.caja_id LEFT JOIN cajas d ON d.id = t.traspaso_caja_id
         LEFT JOIN usuarios u ON u.id = t.cerrado_por LEFT JOIN usuarios ua ON ua.id = t.abierto_por
        WHERE t.id = $1 AND t.cerrado_en IS NOT NULL`, [turnoId]);
    const f = r.rows[0];
    if (!f || !ok(f.caja_id)) return null;
    const m = await c.query(
      `SELECT m.id::text, m.tipo, m.importe::text, m.concepto, m.fecha, u.nombre AS usuario, m.venta_id, m.recibo_id, m.devolucion_id, m.compra_id, m.orden_pago_id, EXISTS (SELECT 1 FROM caja_movimientos x WHERE x.revierte_id = m.id) AS revertido
         FROM caja_movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.turno_id = $1 ORDER BY m.fecha, m.id`, [turnoId]);
    const movimientos: MovimientoDeTurno[] = m.rows.map((x) => ({ id: x.id, tipo: x.tipo, importe: x.importe, concepto: x.concepto, fecha: x.fecha, usuario: x.usuario, revertido: x.revertido, origen: enlaceDeOrigen(x) }));
    // Los totales cuentan lo operado (ventas, cobros, gastos): no las diferencias de arqueo ni los traspasos del cierre.
    const operado = movimientos.filter((x) => !x.revertido && !['apertura_diferencia', 'cierre_diferencia', 'traspaso_salida', 'traspaso_entrada'].includes(x.tipo));
    const suma = (signo: 1 | -1) => deCentavos(operado.reduce((a, x) => (Math.sign(aCentavos(x.importe)) === signo ? a + Math.abs(aCentavos(x.importe)) : a), 0));
    return {
      id: f.id, caja: f.caja, cajaId: f.caja_id, abiertoEn: f.abierto_en, cerradoEn: f.cerrado_en, esperado: f.esperado, contado: f.contado, diferencia: f.diferencia,
      cambioDejado: f.cambio, traspaso: f.traspaso, destino: f.destino, usuario: f.usuario, abiertoPor: f.abierto_por,
      aperturaEsperada: f.ap_esp, aperturaContada: f.ap_con, cierreEsperado: f.esperado, cierreContado: f.contado,
      reabreTurnoId: f.reabre_turno_id, reaperturaMotivo: f.reapertura_motivo, reabiertoPor: f.reabre_turno_id ? f.abierto_por : null, reabierto: f.reabierto_id !== null,
      ingresos: suma(1), egresos: suma(-1), movimientos,
    };
  });
}

/**
 * Reabre una caja cerrada el mismo día (hora de Argentina). Solo administración y con motivo.
 * El cierre queda como estaba: se anulan con movimientos inversos la diferencia de arqueo y el traspaso que generó,
 * y se abre un turno nuevo que continúa el anterior con el saldo resultante.
 */
export async function reabrirCaja(s: SesionActiva, cajaId: string, motivo: string): Promise<void> {
  exigir(s, 'cajas');
  if (s.rol !== 'administrador') throw new ErrorDePermiso('Solo un administrador puede reabrir una caja');
  const razon = (motivo ?? '').trim();
  if (!razon) throw new ErrorDeUsuario('Indicá el motivo de la reapertura');
  if (razon.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  await conTenant(s.tenantId, async (c) => {
    await cajaEn(c, s, cajaId);
    await c.query('SELECT 1 FROM cajas WHERE id = $1 FOR UPDATE', [cajaId]);
    const caja = await cajaEn(c, s, cajaId);
    if (caja.turnoId) throw new ErrorDeUsuario('La caja ya está abierta');
    const t = await c.query<{ id: string; mismo_dia: boolean; reabierto: boolean }>(
      `SELECT t.id, ((t.cerrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS mismo_dia,
              EXISTS (SELECT 1 FROM caja_turnos x WHERE x.reabre_turno_id = t.id) AS reabierto
         FROM caja_turnos t WHERE t.caja_id = $1 AND t.cerrado_en IS NOT NULL ORDER BY t.cerrado_en DESC LIMIT 1`, [cajaId]);
    const ultimo = t.rows[0];
    if (!ultimo) throw new ErrorDeUsuario('Esta caja no tiene cierres para reabrir');
    if (!ultimo.mismo_dia) throw new ErrorDeUsuario('Solo se puede reabrir una caja cerrada hoy');
    if (ultimo.reabierto) throw new ErrorDeUsuario('Ese cierre ya fue reabierto');
    // Lo que generó el cierre: la diferencia de arqueo y el traspaso (con su punta en la otra caja).
    const gen = await c.query<{ id: string; caja_id: string; importe: string }>(
      `SELECT m.id::text, m.caja_id, m.importe::text FROM caja_movimientos m
        WHERE (m.turno_id = $1 AND m.tipo IN ('cierre_diferencia', 'traspaso_salida'))
           OR m.grupo_id IN (SELECT g.grupo_id FROM caja_movimientos g WHERE g.turno_id = $1 AND g.tipo = 'traspaso_salida' AND g.grupo_id IS NOT NULL)
        ORDER BY m.id`, [ultimo.id]);
    for (const m of gen.rows) {
      const ya = await c.query('SELECT 1 FROM caja_movimientos WHERE revierte_id = $1', [m.id]);
      if (ya.rowCount) continue;
      await c.query(
        `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, grupo_id, revierte_id, usuario_id)
         VALUES (app.tenant_id(), $1, NULL, 'reversion', $2, 'Reapertura de caja', NULL, $3, $4)`, [m.caja_id, neg(m.importe), m.id, s.usuarioId]);
    }
    const saldo = (await c.query<{ s: string }>('SELECT COALESCE(sum(importe), 0)::numeric(14,2)::text AS s FROM caja_movimientos WHERE caja_id = $1', [cajaId])).rows[0]!.s;
    await c.query(
      `INSERT INTO caja_turnos (tenant_id, caja_id, abierto_por, apertura_esperada, apertura_contada, reabre_turno_id, reapertura_motivo)
       VALUES (app.tenant_id(), $1, $2, $3, $3, $4, $5)`, [cajaId, s.usuarioId, saldo, ultimo.id, razon]);
    await auditar(c, s.usuarioId, 'reabrir', 'caja', { motivo: razon, cierre: ultimo.id, saldo }, { entidadId: cajaId });
  });
}

/** El cierre de hoy que se puede reabrir (solo administración, caja cerrada y sin reabrir antes), o null. */
export async function cierreReabrible(s: SesionActiva, cajaId: string): Promise<string | null> {
  exigir(s, 'cajas');
  if (s.rol !== 'administrador' || !UUID.test(cajaId)) return null;
  return conTenant(s.tenantId, async (c) => {
    const caja = await cajaEn(c, s, cajaId);
    if (caja.turnoId) return null;
    const r = await c.query<{ id: string }>(
      `SELECT t.id FROM caja_turnos t WHERE t.caja_id = $1 AND t.cerrado_en IS NOT NULL
          AND (t.cerrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
          AND NOT EXISTS (SELECT 1 FROM caja_turnos x WHERE x.reabre_turno_id = t.id)
        ORDER BY t.cerrado_en DESC LIMIT 1`, [cajaId]);
    return r.rows[0]?.id ?? null;
  });
}
