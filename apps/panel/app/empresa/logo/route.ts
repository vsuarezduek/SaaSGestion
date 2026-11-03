import { obtenerLogo } from '../../../lib/empresa.ts';
import { sesionActual } from '../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';

/** El logo del comercio de la sesión. Solo para quien ingresó; el tipo sale del contenido ya verificado al subirlo. */
export async function GET(): Promise<Response> {
  const s = await sesionActual();
  if (!s) return new Response('Ingresá para ver el logo', { status: 401 });
  const logo = await obtenerLogo(s);
  if (!logo) return new Response('Sin logo', { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: { 'content-type': logo.tipo, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300', 'content-security-policy': "default-src 'none'; sandbox" },
  });
}
