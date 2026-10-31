import { listasDePrecios } from '../../../../lib/catalogo.ts';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { listaDePrecios, listaDePreciosCsv } from '../../../../lib/productosArchivos.ts';
import { sesionActual } from '../../../../lib/sesion.ts';
import { filtroDe, type ParamsLista } from '../filtro.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const s = await sesionActual();
  if (!s) return new Response('Ingresá para descargar', { status: 401 });
  const q = new URL(req.url).searchParams;
  const p: ParamsLista = { listas: q.getAll('listas'), rubro: q.get('rubro') ?? '', proveedor: q.get('proveedor') ?? '', extra: q.get('extra') ?? '', valor: q.get('valor') ?? '', stock: q.get('stock') ?? '', mstock: q.get('mstock') ?? '' };
  try {
    const todas = await listasDePrecios(s);
    const csv = listaDePreciosCsv(await listaDePrecios(s, filtroDe(p, todas)));
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="lista-de-precios.csv"', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ErrorDePermiso || e instanceof ErrorDeUsuario) return new Response(e.message, { status: 403 });
    throw e;
  }
}
