import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { aCsv } from '../../../../lib/csv.ts';
import { estadisticasDe, periodoDe, type OrdenProductos } from '../../../../lib/estadisticas.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionActual } from '../../../../lib/sesion.ts';
import { deCentavos } from '../../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const s = await sesionActual();
  if (!s) return new Response('Ingresá para descargar', { status: 401 });
  const q = new URL(req.url).searchParams;
  const orden: OrdenProductos = q.get('orden') === 'unidades' || q.get('orden') === 'rentabilidad' ? (q.get('orden') as OrdenProductos) : 'monto';
  try {
    const d = await estadisticasDe(s, periodoDe(q.get('p') ?? undefined, q.get('desde') ?? undefined, q.get('hasta') ?? undefined), orden);
    const solo = q.get('serie');
    const series = d.series.filter((x) => !solo || x.clave === solo);
    const filas: string[][] = [['Gráfico', 'Detalle', 'Valor']];
    for (const x of series) for (const p of x.puntos) filas.push([x.titulo, p.etiqueta, x.formato === 'pesos' ? deCentavos(p.valor).replace('.', ',') : String(p.valor / 1000).replace('.', ',')]);
    return new Response(aCsv(filas), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="estadisticas-${d.periodo.desde}_${d.periodo.hasta}.csv"`, 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ErrorDePermiso || e instanceof ErrorDeUsuario) return new Response(e.message, { status: 403 });
    throw e;
  }
}
