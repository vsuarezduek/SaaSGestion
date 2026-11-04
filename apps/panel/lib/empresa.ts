// Datos de la empresa y marca visual (logo y color). El logo vive en la base: PNG o JPEG de hasta 1 MB, verificado por su contenido.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaEmpresa, primerError } from './validacion.ts';

export const MAX_LOGO_BYTES = 1_000_000;
export const COLOR_POR_DEFECTO = '#1c9764';

export interface Empresa {
  nombre: string; razonSocial: string | null; cuit: string | null; condicionIva: string | null; domicilio: string | null; localidad: string | null;
  telefono: string | null; email: string | null; web: string | null; color: string; tieneLogo: boolean;
}

/** Cualquier usuario del comercio puede verla (sale en comprobantes e impresiones). */
export async function obtenerEmpresa(s: SesionActiva): Promise<Empresa> {
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT t.nombre, e.razon_social, e.cuit, e.condicion_iva, e.domicilio, e.localidad, e.telefono, e.email, e.web, e.color, e.logo IS NOT NULL AS tiene_logo
         FROM tenants t LEFT JOIN empresa e ON e.tenant_id = t.id WHERE t.id = app.tenant_id()`);
    const f = r.rows[0];
    return {
      nombre: f?.nombre ?? s.comercio, razonSocial: f?.razon_social ?? null, cuit: f?.cuit ?? null, condicionIva: f?.condicion_iva ?? null, domicilio: f?.domicilio ?? null,
      localidad: f?.localidad ?? null, telefono: f?.telefono ?? null, email: f?.email ?? null, web: f?.web ?? null, color: f?.color ?? COLOR_POR_DEFECTO, tieneLogo: Boolean(f?.tiene_logo),
    };
  });
}

export async function guardarEmpresa(s: SesionActiva, entrada: unknown): Promise<void> {
  exigir(s, 'ajustes');
  const v = esquemaEmpresa.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  await conTenant(s.tenantId, async (c) => {
    await c.query('UPDATE tenants SET nombre = $1 WHERE id = app.tenant_id()', [d.nombre]);
    await c.query(
      `INSERT INTO empresa (tenant_id, razon_social, cuit, condicion_iva, domicilio, localidad, telefono, email, web, color)
       VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET razon_social = $1, cuit = $2, condicion_iva = $3, domicilio = $4, localidad = $5, telefono = $6, email = $7, web = $8, color = $9, actualizado_en = now()`,
      [d.razonSocial, d.cuit, d.condicionIva, d.domicilio, d.localidad, d.telefono, d.email, d.web, d.color.toLowerCase()]);
    await auditar(c, s.usuarioId, 'modificar', 'empresa', { nombre: d.nombre, cuit: d.cuit, color: d.color });
  });
}

/** Tipo de imagen según los primeros bytes (no se confía en el nombre ni en el tipo que declara el navegador). */
export function tipoDeImagen(b: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function guardarLogo(s: SesionActiva, bytes: Uint8Array): Promise<void> {
  exigir(s, 'ajustes');
  if (bytes.length === 0) throw new ErrorDeUsuario('Elegí una imagen');
  if (bytes.length > MAX_LOGO_BYTES) throw new ErrorDeUsuario('El logo pesa demasiado (máximo 1 MB)');
  const tipo = tipoDeImagen(bytes);
  if (!tipo) throw new ErrorDeUsuario('El logo tiene que ser una imagen PNG o JPG');
  await conTenant(s.tenantId, async (c) => {
    await c.query(
      `INSERT INTO empresa (tenant_id, logo, logo_tipo) VALUES (app.tenant_id(), $1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET logo = $1, logo_tipo = $2, actualizado_en = now()`, [Buffer.from(bytes), tipo]);
    await auditar(c, s.usuarioId, 'modificar', 'empresa', { logo: tipo, bytes: bytes.length });
  });
}

export async function quitarLogo(s: SesionActiva): Promise<void> {
  exigir(s, 'ajustes');
  await conTenant(s.tenantId, async (c) => {
    await c.query('UPDATE empresa SET logo = NULL, logo_tipo = NULL, actualizado_en = now() WHERE tenant_id = app.tenant_id()');
    await auditar(c, s.usuarioId, 'modificar', 'empresa', { logo: null });
  });
}

export async function obtenerLogo(s: SesionActiva): Promise<{ tipo: string; bytes: Buffer } | null> {
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ logo: Buffer | null; logo_tipo: string | null }>('SELECT logo, logo_tipo FROM empresa WHERE tenant_id = app.tenant_id()');
    const f = r.rows[0];
    return f?.logo && f.logo_tipo ? { tipo: f.logo_tipo, bytes: f.logo } : null;
  });
}
