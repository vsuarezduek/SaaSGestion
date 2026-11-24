import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { aCsv } from '../../../../lib/csv.ts';
import { exigir, ErrorDePermiso } from '../../../../lib/permisos.ts';
import { listarClientes } from '../../../../lib/personas.ts';
import { sesionActual } from '../../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';

/** GET /clientes/csv → clientes.csv («Descargar lista» de la pantalla Clientes, como el prototipo). Pide el permiso «descargar». */
export async function GET(): Promise<Response> {
  const s = await sesionActual();
  if (!s) return new Response('Ingresá para descargar', { status: 401 });
  try {
    exigir(s, 'descargar');
    const { filas } = await listarClientes(s, { estado: 'activos', limite: 5000 });
    const csv = aCsv([
      ['nombre', 'categoria', 'telefono', 'mail', 'domicilio', 'localidad', 'cuit', 'saldo'],
      ...filas.map((f) => [f.nombre, f.categoria ?? '', f.telefono ?? '', f.email ?? '', f.domicilio ?? '', f.localidad ?? '', f.cuit ?? '', f.saldo]),
    ]);
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="clientes.csv"', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ErrorDePermiso || e instanceof ErrorDeUsuario) return new Response(e.message, { status: 403 });
    throw e;
  }
}
