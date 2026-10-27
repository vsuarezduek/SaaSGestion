import { Pool, type PoolClient } from 'pg';

/**
 * Acceso a la base. Regla de entornos (CLAUDE.md): staging y pruebas NUNCA usan la base de producción.
 *  - Producción de Vercel  → DATABASE_URL            (rama "main" de Neon, reservada)
 *  - Cualquier otro entorno → DATABASE_URL_STAGING    (rama "staging"), o DATABASE_URL_LOCAL fuera de Vercel
 * No hay "plan B": si falta la variable correcta, se corta con un error claro.
 */
export function nombreVariable(): string {
  const vercel = process.env.VERCEL_ENV;
  if (vercel === 'production') return 'DATABASE_URL';
  if (vercel) return 'DATABASE_URL_STAGING';
  return process.env.DATABASE_URL_LOCAL ? 'DATABASE_URL_LOCAL' : 'DATABASE_URL_STAGING';
}

export function urlBase(): string {
  const nombre = nombreVariable();
  const url = process.env[nombre];
  if (!url) throw new Error(`Falta la variable de entorno ${nombre}`);
  return url;
}

declare global {
  // eslint-disable-next-line no-var
  var __poolSaasGestion: Pool | undefined;
}

export function pool(): Pool {
  globalThis.__poolSaasGestion ??= new Pool({ connectionString: urlBase(), max: 3 });
  return globalThis.__poolSaasGestion;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta `fn` dentro de una transacción como el rol de la aplicación (app_user, sin permiso para saltear
 * Row Level Security) y con el comercio fijado. Toda consulta de negocio debe pasar por acá.
 */
export async function conTenant<T>(tenantId: string, fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('tenant_id inválido');
  const cliente = await pool().connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SET LOCAL ROLE app_user');
    await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    cliente.release();
  }
}
