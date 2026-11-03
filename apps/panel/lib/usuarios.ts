// Administración de usuarios: alta y edición con rol, permisos extra y cajas visibles; contraseña y PIN; baja lógica.
// Las claves se guardan siempre hasheadas y nunca se auditan. Quien no es administrador no puede crear ni tocar administradores,
// ni dar permisos que no tiene; nadie se cambia su propio rol, ni se desactiva, y siempre queda un administrador activo.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { describirActividad } from './inicio.ts';
import { exigir } from './permisos.ts';
import { esquemaUsuario, primerError } from './validacion.ts';
import { hoyArgentina } from './estadisticas.ts';
import { hashear, validarContrasena, validarPin, verificar } from '../../../packages/seguridad/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = 'America/Argentina/Buenos_Aires';

export interface FilaUsuario {
  id: string; nombre: string; email: string | null; rol: string; permisos: string[]; cajasVisibles: string[] | null;
  activo: boolean; tienePin: boolean; tieneContrasena: boolean; ultimoIngreso: Date | null;
}
const COLUMNAS = `id, nombre, email::text AS email, rol, permisos, cajas_visibles, activo, pin_hash IS NOT NULL AS tiene_pin, password_hash IS NOT NULL AS tiene_pass, ultimo_ingreso`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const aFila = (f: Record<string, any>): FilaUsuario => ({ id: f.id, nombre: f.nombre, email: f.email, rol: f.rol, permisos: f.permisos, cajasVisibles: f.cajas_visibles, activo: f.activo, tienePin: f.tiene_pin, tieneContrasena: f.tiene_pass, ultimoIngreso: f.ultimo_ingreso });

export async function listarUsuarios(s: SesionActiva): Promise<FilaUsuario[]> {
  exigir(s, 'permisos');
  return conTenant(s.tenantId, async (c) => (await c.query(`SELECT ${COLUMNAS} FROM usuarios ORDER BY activo DESC, lower(nombre)`)).rows.map(aFila));
}

export async function obtenerUsuario(s: SesionActiva, id: string): Promise<FilaUsuario | null> {
  exigir(s, 'permisos');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(`SELECT ${COLUMNAS} FROM usuarios WHERE id = $1`, [id]);
    return r.rows[0] ? aFila(r.rows[0]) : null;
  });
}

const esAdmin = (s: SesionActiva): boolean => s.rol === 'administrador';

/** Alta (id null) o edición. Contraseña y PIN vacíos no se cambian. */
export async function guardarUsuario(s: SesionActiva, id: string | null, entrada: unknown): Promise<string> {
  exigir(s, 'permisos');
  const v = esquemaUsuario.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  const contrasena = d.contrasena?.trim() ? d.contrasena : null;
  const pin = d.pin?.trim() ? d.pin.trim() : null;
  if (contrasena) { const m = validarContrasena(contrasena); if (m) throw new ErrorDeUsuario(m); }
  if (pin) { const m = validarPin(pin); if (m) throw new ErrorDeUsuario(m); }
  if (id !== null && !UUID.test(id)) throw new ErrorDeUsuario('El usuario no existe');
  if (!esAdmin(s)) {
    if (d.rol === 'administrador') throw new ErrorDeUsuario('Solo un administrador puede crear o dar el rol de administrador');
    const ajeno = d.permisos.find((p) => !s.permisos.includes(p));
    if (ajeno) throw new ErrorDeUsuario('No podés dar permisos que vos no tenés');
  }
  if (contrasena && !d.email) throw new ErrorDeUsuario('Para tener contraseña el usuario necesita un mail');

  return conTenant(s.tenantId, async (c) => {
    if (d.cajasVisibles && d.cajasVisibles.length > 0) {
      const n = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM cajas WHERE id = ANY($1::uuid[])', [d.cajasVisibles]);
      if (Number(n.rows[0]!.n) !== new Set(d.cajasVisibles).size) throw new ErrorDeUsuario('Alguna de las cajas elegidas no existe');
    }
    const cajas = d.cajasVisibles && d.cajasVisibles.length > 0 ? [...new Set(d.cajasVisibles)] : d.cajasVisibles === null ? null : [];
    const hashC = contrasena ? await hashear(contrasena) : null;
    const hashP = pin ? await hashear(pin) : null;
    try {
      if (id === null) {
        if (d.rol === 'administrador' && !hashC) throw new ErrorDeUsuario('Un administrador necesita contraseña');
        const r = await c.query<{ id: string }>(
          `INSERT INTO usuarios (tenant_id, nombre, email, rol, permisos, cajas_visibles, password_hash, pin_hash)
           VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`, [d.nombre, d.email, d.rol, d.permisos, cajas, hashC, hashP]);
        const nuevo = r.rows[0]!.id;
        await auditar(c, s.usuarioId, 'crear', 'usuario', { nombre: d.nombre, rol: d.rol, permisos: d.permisos, conContrasena: Boolean(hashC), conPin: Boolean(hashP) }, { entidadId: nuevo });
        return nuevo;
      }
      const o = await c.query<{ nombre: string; rol: string; permisos: string[]; activo: boolean; password_hash: string | null }>(
        'SELECT nombre, rol, permisos, activo, password_hash FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
      const ant = o.rows[0];
      if (!ant) throw new ErrorDeUsuario('El usuario no existe');
      if (!esAdmin(s) && ant.rol === 'administrador') throw new ErrorDeUsuario('Solo un administrador puede modificar a otro administrador');
      if (id === s.usuarioId && (ant.rol !== d.rol || [...ant.permisos].sort().join() !== [...d.permisos].sort().join())) {
        throw new ErrorDeUsuario('No podés cambiar tu propio rol ni tus permisos');
      }
      if (d.rol === 'administrador' && !hashC && !ant.password_hash) throw new ErrorDeUsuario('Un administrador necesita contraseña');
      if (ant.rol === 'administrador' && d.rol !== 'administrador') await exigirOtroAdministrador(c, id);
      await c.query(
        `UPDATE usuarios SET nombre = $2, email = $3, rol = $4, permisos = $5, cajas_visibles = $6,
                password_hash = COALESCE($7, password_hash), pin_hash = COALESCE($8, pin_hash) WHERE id = $1`,
        [id, d.nombre, d.email, d.rol, d.permisos, cajas, hashC, hashP]);
      if (hashC) await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);   // una contraseña nueva cierra las sesiones abiertas
      await auditar(c, s.usuarioId, 'modificar', 'usuario',
        { nombre: d.nombre, rol: d.rol, permisos: d.permisos, contrasenaNueva: Boolean(hashC), pinNuevo: Boolean(hashP) },
        { entidadId: id, antes: { nombre: ant.nombre, rol: ant.rol, permisos: ant.permisos } });
      return id;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ya hay un usuario con ese mail');
      throw e;
    }
  });
}

async function exigirOtroAdministrador(c: import('pg').PoolClient, id: string): Promise<void> {
  const r = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM usuarios WHERE rol = 'administrador' AND activo AND id <> $1", [id]);
  if (Number(r.rows[0]!.n) === 0) throw new ErrorDeUsuario('Tiene que quedar al menos un administrador activo');
}

/** Baja lógica y reactivación. No se borran usuarios: sus operaciones quedan a su nombre. */
export async function cambiarEstadoUsuario(s: SesionActiva, id: string, activo: boolean): Promise<void> {
  exigir(s, 'permisos');
  if (!UUID.test(id)) throw new ErrorDeUsuario('El usuario no existe');
  if (id === s.usuarioId) throw new ErrorDeUsuario('No podés desactivarte a vos mismo');
  await conTenant(s.tenantId, async (c) => {
    const o = await c.query<{ rol: string; activo: boolean }>('SELECT rol, activo FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
    const u = o.rows[0];
    if (!u) throw new ErrorDeUsuario('El usuario no existe');
    if (!esAdmin(s) && u.rol === 'administrador') throw new ErrorDeUsuario('Solo un administrador puede modificar a otro administrador');
    if (u.activo === activo) return;
    if (!activo && u.rol === 'administrador') await exigirOtroAdministrador(c, id);
    await c.query('UPDATE usuarios SET activo = $2 WHERE id = $1', [id, activo]);
    if (!activo) await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
    await auditar(c, s.usuarioId, activo ? 'reactivar' : 'desactivar', 'usuario', undefined, { entidadId: id });
  });
}

/** La propia contraseña: pide la actual. Cierra las demás sesiones del usuario. */
export async function cambiarMiContrasena(s: SesionActiva, actual: string, nueva: string): Promise<void> {
  const m = validarContrasena(nueva);
  if (m) throw new ErrorDeUsuario(m);
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ password_hash: string | null }>('SELECT password_hash FROM usuarios WHERE id = $1', [s.usuarioId]);
    if (!r.rows[0]?.password_hash) throw new ErrorDeUsuario('Tu usuario no tiene contraseña: pedile al administrador que te la cree');
    if (!(await verificar(actual, r.rows[0].password_hash))) throw new ErrorDeUsuario('La contraseña actual no es correcta');
    await c.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [s.usuarioId, await hashear(nueva)]);
    await auditar(c, s.usuarioId, 'modificar', 'usuario', { contrasenaNueva: true }, { entidadId: s.usuarioId });
  });
}

/** El propio PIN: si ya tenía, pide el actual; si es administrador, pide la contraseña. */
export async function cambiarMiPin(s: SesionActiva, actual: string, nuevo: string): Promise<void> {
  const m = validarPin(nuevo);
  if (m) throw new ErrorDeUsuario(m);
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ pin_hash: string | null; password_hash: string | null; rol: string }>('SELECT pin_hash, password_hash, rol FROM usuarios WHERE id = $1', [s.usuarioId]);
    const u = r.rows[0]!;
    if (u.rol === 'administrador') {
      if (!(await verificar(actual, u.password_hash))) throw new ErrorDeUsuario('Para cambiar el PIN poné tu contraseña');
    } else if (u.pin_hash && !(await verificar(actual, u.pin_hash))) {
      throw new ErrorDeUsuario('El PIN actual no es correcto');
    }
    await c.query('UPDATE usuarios SET pin_hash = $2 WHERE id = $1', [s.usuarioId, await hashear(nuevo)]);
    await auditar(c, s.usuarioId, 'modificar', 'usuario', { pinNuevo: true }, { entidadId: s.usuarioId });
  });
}

// ───────── Actividad por usuario ─────────
export interface ActividadDeUsuario {
  ventasHoy: { operaciones: number; total: number }; ventasMes: { operaciones: number; total: number };
  ultimas: { cuando: Date; texto: string; enlace: string | null }[];
}

/** Lo que hizo una persona: ventas de hoy y del mes (en centavos) y sus últimas acciones. */
export async function actividadDeUsuario(s: SesionActiva, id: string): Promise<ActividadDeUsuario | null> {
  exigir(s, 'permisos');
  if (!UUID.test(id)) return null;
  const hoy = hoyArgentina();
  const mes = `${hoy.slice(0, 7)}-01`;
  return conTenant(s.tenantId, async (c) => {
    const u = await c.query<{ nombre: string }>('SELECT nombre FROM usuarios WHERE id = $1', [id]);
    if (!u.rows[0]) return null;
    const ventas = async (desde: string) => {
      const r = await c.query<{ t: string; n: string }>(
        `SELECT COALESCE(sum(v.total * (CASE WHEN v.comprobante = 'nota_credito' THEN -1 ELSE 1 END)), 0) * 100 AS t,
                count(*) FILTER (WHERE v.comprobante <> 'nota_credito') AS n
           FROM ventas v WHERE v.usuario_id = $1 AND v.estado = 'cerrada' AND v.fecha >= ($2::date::timestamp AT TIME ZONE '${TZ}')`, [id, desde]);
      return { operaciones: Number(r.rows[0]!.n), total: Math.round(Number(r.rows[0]!.t)) };
    };
    const a = await c.query<{ creado_en: Date; accion: string; entidad: string }>(
      'SELECT creado_en, accion, entidad FROM auditoria WHERE usuario_id = $1 ORDER BY id DESC LIMIT 20', [id]);
    return {
      ventasHoy: await ventas(hoy), ventasMes: await ventas(mes),
      ultimas: a.rows.map((f) => ({ cuando: f.creado_en, ...describirActividad(u.rows[0]!.nombre, f.accion, f.entidad) })),
    };
  });
}
