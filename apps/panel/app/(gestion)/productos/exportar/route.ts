import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { COLUMNAS_EXPORTABLES, exportarProductosCsv, type ColumnaExportable } from '../../../../lib/productosArchivos.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionActual } from '../../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';

/** GET /productos/exportar?cols=rubro,costo,precios → productos.csv (el código y el nombre van siempre). */
export async function GET(req: Request): Promise<Response> {
  const s = await sesionActual();
  if (!s) return new Response('Ingresá para descargar', { status: 401 });
  const pedidas = (new URL(req.url).searchParams.get('cols') ?? '').split(',');
  const cols = pedidas.length === 1 && pedidas[0] === '' ? [...COLUMNAS_EXPORTABLES] : (pedidas.filter((c) => (COLUMNAS_EXPORTABLES as readonly string[]).includes(c)) as ColumnaExportable[]);
  try {
    const csv = await exportarProductosCsv(s, cols);
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="productos.csv"', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ErrorDePermiso || e instanceof ErrorDeUsuario) return new Response(e.message, { status: 403 });
    throw e;
  }
}
