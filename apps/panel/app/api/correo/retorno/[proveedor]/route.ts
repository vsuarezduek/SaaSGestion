import { guardarConexion } from '../../../../../lib/correo.ts';
import { verificar } from '../../../../../lib/correoCifrado.ts';
import { canjearCodigo, ErrorDeCorreo, esProveedor } from '../../../../../lib/correoOauth.ts';
import { sesionActual } from '../../../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';
const base = () => (process.env.CORREO_URL_BASE ?? '').replace(/\/+$/, '');
const borrar = 'sg_correo_estado=; Path=/api/correo; HttpOnly; SameSite=Lax; Max-Age=0';
const volver = (q: string) => new Response(null, { status: 303, headers: { location: `${base()}/ajustes/correo?${q}`, 'set-cookie': borrar } });
const fallo = (m: string) => volver('error=' + encodeURIComponent(m));

/** Vuelta del proveedor: se comprueba que el estado sea nuestro, vigente y de esta misma persona y navegador, y recién ahí se guarda la conexión. */
export async function GET(req: Request, { params }: { params: Promise<{ proveedor: string }> }): Promise<Response> {
  const { proveedor } = await params;
  const url = new URL(req.url);
  const s = await sesionActual();
  if (!s) return new Response(null, { status: 303, headers: { location: '/ingresar', 'set-cookie': borrar } });
  if (!esProveedor(proveedor)) return fallo('Proveedor de correo desconocido');
  if (url.searchParams.get('error')) return fallo('No se autorizó la conexión');
  const estado = verificar<{ t: string; u: string; p: string; n: string; e: number }>(url.searchParams.get('state') ?? '');
  const nonce = /(?:^|;\s*)sg_correo_estado=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1];
  if (!estado || !nonce || estado.n !== nonce || estado.p !== proveedor || estado.t !== s.tenantId || estado.u !== s.usuarioId || estado.e < Date.now()) {
    return fallo('La conexión expiró o no es válida. Probá de nuevo.');
  }
  const codigo = url.searchParams.get('code');
  if (!codigo) return fallo('El proveedor no devolvió el permiso');
  try {
    const { refresco, cuenta } = await canjearCodigo(proveedor, codigo);
    await guardarConexion(s, proveedor, cuenta, refresco);
  } catch (e) {
    return fallo(e instanceof ErrorDeCorreo ? e.message : 'No se pudo completar la conexión');
  }
  return volver('ok=1');
}
