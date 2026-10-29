// Cajas: turnos (apertura/cierre con arqueo) y libro de movimientos de solo agregar.
// El saldo es la suma de movimientos. Caja cerrada = bloqueada (la base lo garantiza además de esta capa).
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
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

// ───────── Movimientos ─────────
export interface MovimientoCaja {
  id: string; tipo: string; importe: string; concepto: string | null; fecha: Date; usuario: string | null; revertido: boolean; revierteId: string | null; enTransferencia: boolean;
}

export async function movimientosDeCaja(s: SesionActiva, cajaId: string, limite = 10): Promise<MovimientoCaja[]> {
  exigir(s, 'cajas');
  return conTenant(s.tenantId, async (c) => {
    await cajaEn(c, s, cajaId);
    // El administrador ve los movimientos de todos; los demás, solo los suyos.
    const soloPropios = s.rol !== 'administrador';
    const r = await c.query(
      `SELECT m.id::text, m.tipo, m.importe::text, m.concepto, m.fecha, u.nombre AS usuario, m.revierte_id::text, m.grupo_id IS NOT NULL AS en_transferencia,
              EXISTS (SELECT 1 FROM caja_movimientos x WHERE x.revierte_id = m.id) AS revertido
         FROM caja_movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.caja_id = $1 ${soloPropios ? 'AND m.usuario_id = $2' : ''}
        ORDER BY m.fecha DESC, m.id DESC LIMIT ${Math.min(Math.max(limite, 1), 500)}`,
      soloPropios ? [cajaId, s.usuarioId] : [cajaId],
    );
    return r.rows.map((f) => ({ id: f.id, tipo: f.tipo, importe: f.importe, concepto: f.concepto, fecha: f.fecha, usuario: f.usuario, revertido: f.revertido, revierteId: f.revierte_id, enTransferencia: f.en_transferencia }));
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
