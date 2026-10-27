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

export async function cerrarPool(): Promise<void> {
  const p = globalThis.__poolSaasGestion;
  globalThis.__poolSaasGestion = undefined;
  if (p) await p.end();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (s: string): boolean => UUID.test(s);

async function enTransaccion<T>(preparar: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool().connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SET LOCAL ROLE app_user');
    await preparar(cliente);
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

/**
 * Ejecuta `fn` dentro de una transacción como el rol de la aplicación (app_user, sin permiso para saltear
 * Row Level Security) y con el comercio fijado. Toda consulta de negocio debe pasar por acá.
 * Si `fn` devuelve normalmente se confirma (COMMIT); si lanza un error se deshace (ROLLBACK).
 */
export async function conTenant<T>(tenantId: string, fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  if (!esUuid(tenantId)) throw new Error('tenant_id inválido');
  return enTransaccion((c) => c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]).then(() => undefined), fn);
}

/**
 * Para lo que ocurre antes de conocer el comercio (resolver el comercio por su identificador, crear uno nuevo).
 * Corre como app_user, sin comercio fijado: solo puede usar las funciones de entrada de la base.
 */
export async function sinTenant<T>(fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  return enTransaccion(async () => undefined, fn);
}
