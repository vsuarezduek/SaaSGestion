// Ingreso, sesiones y alta de comercios. Sin dependencias de Next: se prueba directamente con node --test.
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { conTenant, esUuid, sinTenant } from './db.ts';
import {
  hashDeToken,
  hashear,
  nuevoToken,
  validarContrasena,
  verificar,
} from '../../../packages/seguridad/src/index.ts';

export const MAX_FALLOS_POR_EMAIL = 5;
export const MAX_FALLOS_POR_IP = 20;
export const VENTANA_MINUTOS = 15;
const LARGO_MAXIMO_CONTRASENA = 200;
const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Error con un mensaje que se le puede mostrar al usuario tal cual. */
export class ErrorDeUsuario extends Error {}

export const normalizarEmail = (s: string): string => s.trim().toLowerCase();
const hashIp = (ip: string): string =>
  createHash('sha256').update((process.env.IP_SALT ?? '') + ip).digest('hex');

// Hash de relleno: si el usuario no existe igual se hace el cálculo, para no delatar con el tiempo qué correos existen.
let hashFalso: Promise<string> | undefined;
const relleno = (): Promise<string> => (hashFalso ??= hashear('relleno-que-nadie-usa'));

export interface ComercioPublico {
  id: string;
  nombre: string;
  estado: string;
  zona_horaria: string;
}

export async function comercioPorSlug(slug: string): Promise<ComercioPublico | null> {
  const s = slug.trim().toLowerCase();
  if (!SLUG.test(s)) return null;
  const r = await sinTenant((c) =>
    c.query<ComercioPublico>('SELECT id, nombre, estado, zona_horaria FROM app.tenant_por_slug($1)', [s]),
  );
  return r.rows[0] ?? null;
}

export interface AltaComercio {
  slug: string;
  nombre: string;
  rubro?: string;
  email: string;
  nombreAdmin: string;
  contrasena: string;
}

export async function crearComercio(a: AltaComercio): Promise<string> {
  const slug = a.slug.trim().toLowerCase();
  const email = normalizarEmail(a.email);
  if (!SLUG.test(slug)) throw new ErrorDeUsuario('El identificador debe tener 3 a 40 letras minúsculas, números o guiones');
  if (!a.nombre.trim()) throw new ErrorDeUsuario('Falta el nombre del comercio');
  if (!a.nombreAdmin.trim()) throw new ErrorDeUsuario('Falta el nombre del administrador');
  if (!EMAIL.test(email)) throw new ErrorDeUsuario('El correo no es válido');
  const errorClave = validarContrasena(a.contrasena);
  if (errorClave) throw new ErrorDeUsuario(errorClave);
  const hash = await hashear(a.contrasena);
  try {
    const r = await sinTenant((c) =>
      c.query<{ id: string }>('SELECT app.crear_comercio($1, $2, $3, $4, $5, $6) AS id', [
        slug,
        a.nombre.trim(),
        a.rubro?.trim() || 'general',
        email,
        a.nombreAdmin.trim(),
        hash,
      ]),
    );
    return r.rows[0]!.id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ese identificador de comercio ya existe');
    throw e;
  }
}

export async function auditar(
  c: PoolClient,
  usuarioId: string | null,
  accion: string,
  entidad: string,
  despues?: unknown,
  extra: { entidadId?: string; antes?: unknown } = {},
): Promise<void> {
  await c.query(
    `INSERT INTO auditoria (tenant_id, usuario_id, accion, entidad, entidad_id, antes, despues)
     VALUES (app.tenant_id(), $1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      usuarioId,
      accion,
      entidad,
      extra.entidadId ?? null,
      extra.antes === undefined ? null : JSON.stringify(extra.antes),
      despues === undefined ? null : JSON.stringify(despues),
    ],
  );
}

export type ResultadoIngreso =
  | { ok: true; cookie: string; expiraEn: Date }
  | { ok: false; motivo: 'credenciales' | 'bloqueado' };

export async function ingresar(e: { slug: string; email: string; contrasena: string; ip: string }): Promise<ResultadoIngreso> {
  const email = normalizarEmail(e.email);
  if (e.contrasena.length === 0 || e.contrasena.length > LARGO_MAXIMO_CONTRASENA) return { ok: false, motivo: 'credenciales' };
  const comercio = await comercioPorSlug(e.slug);
  if (!comercio || comercio.estado === 'suspendido') {
    await verificar(e.contrasena, await relleno());
    return { ok: false, motivo: 'credenciales' };
  }
  const ipHash = hashIp(e.ip);

  return conTenant(comercio.id, async (c): Promise<ResultadoIngreso> => {
    const f = await c.query<{ por_email: string; por_ip: string }>(
      `SELECT count(*) FILTER (WHERE email = $1)::text AS por_email,
              count(*) FILTER (WHERE ip_hash = $2)::text AS por_ip
         FROM intentos_ingreso
        WHERE exito = false AND creado_en > now() - make_interval(mins => $3::int)`,
      [email, ipHash, VENTANA_MINUTOS],
    );
    // Bloqueado: no se registra ni se audita cada intento (los fallos que llevaron al bloqueo ya quedaron registrados).
    if (Number(f.rows[0]!.por_email) >= MAX_FALLOS_POR_EMAIL || Number(f.rows[0]!.por_ip) >= MAX_FALLOS_POR_IP) {
      return { ok: false, motivo: 'bloqueado' };
    }

    const u = await c.query<{ id: string; password_hash: string | null }>(
      'SELECT id, password_hash FROM usuarios WHERE email = $1 AND activo',
      [email],
    );
    const usuario = u.rows[0];
    const coincide = await verificar(e.contrasena, usuario?.password_hash ?? (await relleno()));
    if (!usuario || !coincide) {
      await c.query('INSERT INTO intentos_ingreso (tenant_id, email, ip_hash, exito) VALUES (app.tenant_id(), $1, $2, false)', [email, ipHash]);
      await auditar(c, usuario?.id ?? null, 'ingreso_fallido', 'sesion', { email });
      return { ok: false, motivo: 'credenciales' };
    }

    await c.query('DELETE FROM intentos_ingreso WHERE email = $1', [email]);
    await c.query('DELETE FROM sesiones WHERE expira_en < now()');
    const t = nuevoToken();
    await c.query('INSERT INTO sesiones (tenant_id, usuario_id, token_hash, expira_en) VALUES (app.tenant_id(), $1, $2, $3)', [
      usuario.id,
      t.tokenHash,
      t.expiraEn,
    ]);
    await c.query('UPDATE usuarios SET ultimo_ingreso = now() WHERE id = $1', [usuario.id]);
    await auditar(c, usuario.id, 'ingresar', 'sesion', { email });
    // La cookie lleva el comercio y el token: el comercio no es secreto, el token sí.
    return { ok: true, cookie: `${comercio.id}.${t.token}`, expiraEn: t.expiraEn };
  });
}

export interface SesionActiva {
  usuarioId: string;
  tenantId: string;
  comercio: string;
  nombre: string;
  email: string | null;
  rol: string;
  permisos: string[];
}

function partirCookie(valor: string | undefined): { tenantId: string; token: string } | null {
  if (!valor) return null;
  const i = valor.indexOf('.');
  if (i < 0) return null;
  const tenantId = valor.slice(0, i);
  const token = valor.slice(i + 1);
  if (!esUuid(tenantId) || token.length < 20 || token.length > 100) return null;
  return { tenantId, token };
}

export async function sesionDesdeCookie(valor: string | undefined): Promise<SesionActiva | null> {
  const p = partirCookie(valor);
  if (!p) return null;
  return conTenant(p.tenantId, async (c) => {
    const r = await c.query<{ id: string; nombre: string; email: string | null; rol: string; permisos: string[]; comercio: string }>(
      `SELECT u.id, u.nombre, u.email::text AS email, u.rol, u.permisos, t.nombre AS comercio
         FROM sesiones s
         JOIN usuarios u ON u.tenant_id = s.tenant_id AND u.id = s.usuario_id
         JOIN tenants t ON t.id = s.tenant_id
        WHERE s.token_hash = $1 AND s.expira_en > now() AND u.activo`,
      [hashDeToken(p.token)],
    );
    const f = r.rows[0];
    if (!f) return null;
    return { usuarioId: f.id, tenantId: p.tenantId, comercio: f.comercio, nombre: f.nombre, email: f.email, rol: f.rol, permisos: f.permisos };
  });
}

export async function cerrarSesion(valor: string | undefined): Promise<void> {
  const p = partirCookie(valor);
  if (!p) return;
  await conTenant(p.tenantId, async (c) => {
    const r = await c.query<{ usuario_id: string }>('DELETE FROM sesiones WHERE token_hash = $1 RETURNING usuario_id', [hashDeToken(p.token)]);
    const f = r.rows[0];
    if (f) await auditar(c, f.usuario_id, 'salir', 'sesion');
  });
}
