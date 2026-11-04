// Cifrado de los tokens de la casilla de cada comercio (AES-256-GCM). El comercio entra como dato autenticado:
// un token copiado a otro comercio no se puede descifrar. La clave vive en la variable de entorno CORREO_CLAVE (32 bytes en base64).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

export function claveDeEntorno(env: NodeJS.ProcessEnv = process.env): Buffer {
  const b64 = env.CORREO_CLAVE;
  if (!b64) throw new Error('Falta la variable de entorno CORREO_CLAVE');
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('CORREO_CLAVE debe ser de 32 bytes en base64');
  return k;
}

export function cifrar(texto: string, tenantId: string, clave: Buffer = claveDeEntorno()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  c.setAAD(Buffer.from(tenantId));
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [VERSION, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function descifrar(token: string, tenantId: string, clave: Buffer = claveDeEntorno()): string {
  const [v, iv, tag, ct] = token.split('.');
  if (v !== VERSION || !iv || !tag || !ct) throw new Error('Token de correo con formato desconocido');
  const d = createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(tenantId));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** Firma un objeto (estado del flujo OAuth) con vencimiento. */
export function firmar(datos: Record<string, string | number>, clave: Buffer = claveDeEntorno()): string {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  const sello = createHmac('sha256', clave).update('estado:' + cuerpo).digest('base64url');
  return `${cuerpo}.${sello}`;
}

export function verificar<T extends Record<string, string | number>>(token: string, clave: Buffer = claveDeEntorno()): T | null {
  const [cuerpo, sello] = token.split('.');
  if (!cuerpo || !sello) return null;
  const esperado = createHmac('sha256', clave).update('estado:' + cuerpo).digest();
  const dado = Buffer.from(sello, 'base64url');
  if (dado.length !== esperado.length || !timingSafeEqual(dado, esperado)) return null;
  try {
    return JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
