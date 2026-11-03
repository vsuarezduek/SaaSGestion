import { ErrorDeUsuario } from '../../../../../lib/auth.ts';
import { aCsv } from '../../../../../lib/csv.ts';
import { informeDeProductos, type ParamsInformeProductos } from '../../../../../lib/informeProductos.ts';
import { ErrorDePermiso } from '../../../../../lib/permisos.ts';
import { sesionActual } from '../../../../../lib/sesion.ts';
import { formatearCantidad } from '../../../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const s = await sesionActual();
  if (!s) return new Response('Ingresá para descargar', { status: 401 });
  const q = new URL(req.url).searchParams;
  const p: ParamsInformeProductos = { q: q.get('q') ?? '', rubro: q.get('rubro') ?? '', proveedor: q.get('proveedor') ?? '', extra: q.get('extra') ?? '', valor: q.get('valor') ?? '', venta: q.get('venta') ?? '', estado: q.get('estado') ?? '', alerta: q.get('alerta') ?? '' };
  try {
    const r = await informeDeProductos(s, p);
    const csv = aCsv([['Código', 'Producto', 'Rubro', 'Unidad', 'Stock', 'Costo', 'IVA %'],
      ...r.filas.map((f) => [f.codigo ?? '', f.nombre, f.rubro ?? '', f.unidad, formatearCantidad(f.stock), f.costo.replace('.', ','), f.iva])]);
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="informe-productos.csv"', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ErrorDePermiso || e instanceof ErrorDeUsuario) return new Response(e.message, { status: 403 });
    throw e;
  }
}
