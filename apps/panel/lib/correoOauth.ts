// Flujo OAuth con Google (Gmail) y Microsoft (Outlook) y envío por sus APIs, sin dependencias: solo fetch (inyectable para probar).
// Solo se pide permiso para ENVIAR mails; no se puede leer la casilla.
import { armarMime, type MensajeDeMail } from './mime.ts';

export type ProveedorCorreo = 'google' | 'microsoft';
export const PROVEEDORES: ProveedorCorreo[] = ['google', 'microsoft'];
export type Fetch = typeof fetch;

interface Config { clientId: string; secreto: string }

export function configDe(p: ProveedorCorreo, env: NodeJS.ProcessEnv = process.env): Config | null {
  const [id, sec] = p === 'google' ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET] : [env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET];
  return id && sec ? { clientId: id, secreto: sec } : null;
}
export function proveedoresDisponibles(env: NodeJS.ProcessEnv = process.env): ProveedorCorreo[] {
  return PROVEEDORES.filter((p) => configDe(p, env) !== null);
}
export function esProveedor(x: string): x is ProveedorCorreo {
  return x === 'google' || x === 'microsoft';
}
/** Dirección a la que vuelve el proveedor; debe estar registrada tal cual en Google / Microsoft. */
export function urlDeRetorno(p: ProveedorCorreo, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.CORREO_URL_BASE ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Falta la variable de entorno CORREO_URL_BASE (por ejemplo https://app.midominio.com)');
  return `${base}/api/correo/retorno/${p}`;
}

const GOOGLE = { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email https://www.googleapis.com/auth/gmail.send' };
const MICROSOFT = { auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'openid email offline_access https://graph.microsoft.com/Mail.Send' };
const datos = (p: ProveedorCorreo) => (p === 'google' ? GOOGLE : MICROSOFT);

export function urlDeAutorizacion(p: ProveedorCorreo, estado: string, env: NodeJS.ProcessEnv = process.env): string {
  const cfg = configDe(p, env);
  if (!cfg) throw new Error('El proveedor de correo no está configurado');
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: urlDeRetorno(p, env), response_type: 'code', scope: datos(p).scope, state: estado });
  if (p === 'google') { q.set('access_type', 'offline'); q.set('prompt', 'consent'); } else q.set('prompt', 'select_account');
  return `${datos(p).auth}?${q}`;
}

/** Mail de la cuenta que autorizó, leído del id_token que el proveedor entrega directamente por TLS en el intercambio. */
export function mailDelIdToken(idToken: string): string | null {
  try {
    const carga = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: string; preferred_username?: string };
    const m = (carga.email ?? carga.preferred_username ?? '').toLowerCase();
    return /^[^@\s]+@[^@\s]+$/.test(m) ? m : null;
  } catch {
    return null;
  }
}

async function pedirToken(p: ProveedorCorreo, cuerpo: Record<string, string>, f: Fetch, env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const cfg = configDe(p, env)!;
  const r = await f(datos(p).token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secreto, ...cuerpo }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ErrorDeCorreo(j.error === 'invalid_grant' ? 'La conexión con la casilla venció. Volvé a conectarla en Ajustes → Correo.' : 'No se pudo hablar con el proveedor de correo', j.error === 'invalid_grant');
  return j;
}

export class ErrorDeCorreo extends Error {
  reconectar: boolean;
  constructor(mensaje: string, reconectar = false) {
    super(mensaje);
    this.reconectar = reconectar;
  }
}

/** Canjea el código de autorización: devuelve el token de renovación y la cuenta conectada. */
export async function canjearCodigo(p: ProveedorCorreo, codigo: string, f: Fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<{ refresco: string; cuenta: string }> {
  const j = await pedirToken(p, { grant_type: 'authorization_code', code: codigo, redirect_uri: urlDeRetorno(p, env) }, f, env);
  const refresco = typeof j.refresh_token === 'string' ? j.refresh_token : '';
  const cuenta = typeof j.id_token === 'string' ? mailDelIdToken(j.id_token) : null;
  if (!refresco) throw new ErrorDeCorreo('El proveedor no entregó permiso para enviar. Probá de nuevo y aceptá todos los permisos.');
  if (!cuenta) throw new ErrorDeCorreo('No se pudo saber qué casilla se conectó');
  return { refresco, cuenta };
}

export async function tokenDeAcceso(p: ProveedorCorreo, refresco: string, f: Fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const j = await pedirToken(p, { grant_type: 'refresh_token', refresh_token: refresco, ...(p === 'microsoft' ? { scope: MICROSOFT.scope } : {}) }, f, env);
  if (typeof j.access_token !== 'string') throw new ErrorDeCorreo('No se pudo obtener permiso para enviar');
  return j.access_token;
}

/** Envía el mensaje desde la casilla conectada. */
export async function enviarMensaje(p: ProveedorCorreo, acceso: string, m: MensajeDeMail, f: Fetch = fetch): Promise<void> {
  let r: Response;
  if (p === 'google') {
    const raw = Buffer.from(armarMime(m), 'utf8').toString('base64url');
    r = await f('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { authorization: `Bearer ${acceso}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });
  } else {
    armarMime(m); // valida direcciones
    r = await f('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST', headers: { authorization: `Bearer ${acceso}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: m.asunto.replace(/[\r\n]+/g, ' '), body: { contentType: 'HTML', content: m.html },
          toRecipients: [{ emailAddress: { address: m.para } }],
          ...(m.responderA ? { replyTo: [{ emailAddress: { address: m.responderA } }] } : {}),
        },
        saveToSentItems: true,
      }),
    });
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new ErrorDeCorreo('La casilla rechazó el envío. Volvé a conectarla en Ajustes → Correo.', true);
    throw new ErrorDeCorreo('El proveedor de correo no pudo enviar el mensaje. Probá de nuevo en unos minutos.');
  }
}

/** Revoca el permiso del lado de Google (Microsoft no ofrece revocación por API: se quita desde la cuenta de la persona). */
export async function revocar(p: ProveedorCorreo, refresco: string, f: Fetch = fetch): Promise<void> {
  if (p !== 'google') return;
  await f('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresco }) }).catch(() => undefined);
}
