import { randomBytes } from 'node:crypto';
import { firmar } from '../../../../../lib/correoCifrado.ts';
import { configDe, esProveedor, urlDeAutorizacion } from '../../../../../lib/correoOauth.ts';
import { puede, type Rol } from '../../../../../../../packages/seguridad/src/index.ts';
import { sesionActual } from '../../../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';
const COOKIE_ESTADO = 'sg_correo_estado';
const base = () => (process.env.CORREO_URL_BASE ?? '').replace(/\/+$/, '');
const volver = (q: string, extra: HeadersInit = {}) => new Response(null, { status: 303, headers: { location: `${base()}/ajustes/correo?${q}`, ...extra } });

/** Inicia la conexión: manda a la persona a Google o Microsoft para que autorice el envío desde su casilla. Solo con permiso de ajustes. */
export async function GET(_req: Request, { params }: { params: Promise<{ proveedor: string }> }): Promise<Response> {
  const { proveedor } = await params;
  const s = await sesionActual();
  if (!s) return new Response(null, { status: 303, headers: { location: '/ingresar' } });
  if (!puede({ rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: null }, 'ajustes')) return new Response('No tenés permiso para cambiar los ajustes', { status: 403 });
  if (!esProveedor(proveedor) || !configDe(proveedor)) return volver('error=' + encodeURIComponent('Ese proveedor de correo no está habilitado'));
  const nonce = randomBytes(18).toString('base64url');
  const estado = firmar({ t: s.tenantId, u: s.usuarioId, p: proveedor, n: nonce, e: Date.now() + 10 * 60_000 });
  const cookie = `${COOKIE_ESTADO}=${nonce}; Path=/api/correo; HttpOnly; SameSite=Lax; Max-Age=600${process.env.VERCEL_ENV ? '; Secure' : ''}`;
  return new Response(null, { status: 303, headers: { location: urlDeAutorizacion(proveedor, estado), 'set-cookie': cookie } });
}
