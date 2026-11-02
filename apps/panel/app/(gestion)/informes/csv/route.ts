import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { aCsv } from '../../../../lib/csv.ts';
import { periodoDe } from '../../../../lib/estadisticas.ts';
import { informeDePersonas } from '../../../../lib/informes.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionActual } from '../../../../lib/sesion.ts';
import { deCentavos } from '../../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const s = await sesionActual();
  if (!s) return new Response('Ingresá para descargar', { status: 401 });
  const q = new URL(req.url).searchParams;
  const tipo = q.get('tipo') === 'proveedor' ? 'proveedor' : 'cliente';
  try {
    const per = periodoDe(q.get('p') ?? undefined, q.get('desde') ?? undefined, q.get('hasta') ?? undefined);
    const filas = await informeDePersonas(s, tipo, per, q.get('deuda') === '1');
    const n = (c: number) => deCentavos(c).replace('.', ',');
    const f = (d: Date | null) => (d ? new Date(d).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '');
    const csv = aCsv([[tipo === 'cliente' ? 'Cliente' : 'Proveedor', 'Total', 'Operaciones', 'Ticket promedio', 'Saldo', 'Última operación'],
      ...filas.map((x) => [x.nombre, n(x.total), String(x.operaciones), n(x.ticketPromedio), n(x.saldo), f(x.ultima)])]);
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="informe-${tipo}s-${per.desde}_${per.hasta}.csv"`, 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ErrorDePermiso || e instanceof ErrorDeUsuario) return new Response(e.message, { status: 403 });
    throw e;
  }
}
