import { redirect } from 'next/navigation';
import Link from 'next/link';
import { formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { botonSecundario, campo, error, pagina } from '../../../lib/estilos.ts';
import { periodoDe } from '../../../lib/estadisticas.ts';
import { informeDePersonas, type FilaInforme, type TipoPersona } from '../../../lib/informes.ts';
import { sesionActual } from '../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const OPCIONES = [['hoy', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mes_anterior', 'Mes anterior'], ['anio', 'Este año']] as const;
const fecha = (d: Date | null) => (d ? new Date(d).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '–');

export default async function Informes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sesion = await sesionActual();
  if (!sesion) redirect('/ingresar');
  const q = await searchParams;
  const tipo: TipoPersona = q.tipo === 'proveedor' ? 'proveedor' : 'cliente';
  let filas: FilaInforme[] = [], problema = '', nombre = '';
  try {
    const per = periodoDe(q.p, q.desde, q.hasta);
    nombre = `${per.nombre}: ${per.desde} al ${per.hasta}`;
    filas = await informeDePersonas(sesion, tipo, per, q.deuda === '1');
  } catch (e) {
    if (!(e instanceof ErrorDeUsuario)) throw e;
    problema = e.message;
  }
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  const enlace = (extra: Record<string, string>) => `/informes?${new URLSearchParams({ ...Object.fromEntries(params), ...extra })}`;
  const plural = tipo === 'cliente' ? 'Clientes' : 'Proveedores';
  return (
    <main style={{ ...pagina, maxWidth: 820 }}>
      <h1 style={{ marginTop: 0 }}>Informes de {plural.toLowerCase()}</h1>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {(['cliente', 'proveedor'] as const).map((t) => <Link key={t} href={enlace({ tipo: t })} style={{ ...botonSecundario, textDecoration: 'none', padding: '6px 10px', ...(tipo === t ? { background: '#1c9764', color: '#fff' } : {}) }}>{t === 'cliente' ? 'Clientes' : 'Proveedores'}</Link>)}
        <Link href="/informes/productos" style={{ ...botonSecundario, textDecoration: 'none', padding: '6px 10px' }}>Productos</Link>
        <span style={{ width: 12 }} />
        {OPCIONES.map(([clave, texto]) => <Link key={clave} href={enlace({ p: clave, desde: '', hasta: '' })} style={{ ...botonSecundario, textDecoration: 'none', padding: '6px 10px', ...((q.p ?? 'mes') === clave && !q.desde ? { background: '#1c9764', color: '#fff' } : {}) }}>{texto}</Link>)}
      </div>
      <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 14 }}>
        <input type="hidden" name="tipo" value={tipo} />
        <label style={{ fontSize: 12, color: '#5c6d66' }}>Desde<input type="date" name="desde" defaultValue={q.desde} style={{ ...campo, width: 'auto' }} /></label>
        <label style={{ fontSize: 12, color: '#5c6d66' }}>Hasta<input type="date" name="hasta" defaultValue={q.hasta} style={{ ...campo, width: 'auto' }} /></label>
        <label style={{ fontSize: 13 }}><input type="checkbox" name="deuda" value="1" defaultChecked={q.deuda === '1'} /> Solo con saldo pendiente</label>
        <button style={{ ...botonSecundario, padding: '9px 14px' }}>Ver</button>
        <a href={`/informes/csv?${params}`} style={{ ...botonSecundario, textDecoration: 'none' }}>Descargar CSV</a>
      </form>
      {problema && <p style={error}>{problema}</p>}
      {nombre && <p style={{ color: '#5c6d66', marginTop: 0 }}>{nombre}</p>}
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left', color: '#5c6d66' }}><th>{tipo === 'cliente' ? 'Cliente' : 'Proveedor'}</th><th style={{ textAlign: 'right' }}>{tipo === 'cliente' ? 'Comprado' : 'Vendido'}</th><th style={{ textAlign: 'right' }}>Operaciones</th><th style={{ textAlign: 'right' }}>Ticket</th><th style={{ textAlign: 'right' }}>Saldo</th><th>Última</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} style={{ borderTop: '1px solid #d3e6de' }}>
              <td><Link href={`/${tipo === 'cliente' ? 'clientes' : 'proveedores'}/${f.id}`} style={{ color: 'inherit' }}>{f.nombre}</Link></td>
              <td style={{ textAlign: 'right' }}>{formatearPesos(f.total)}</td><td style={{ textAlign: 'right' }}>{f.operaciones}</td>
              <td style={{ textAlign: 'right' }}>{formatearPesos(f.ticketPromedio)}</td>
              <td style={{ textAlign: 'right', color: f.saldo > 0 ? '#b4571a' : undefined }}>{formatearPesos(f.saldo)}</td><td>{fecha(f.ultima)}</td>
            </tr>
          ))}
          {filas.length === 0 && !problema && <tr><td colSpan={6} style={{ color: '#5c6d66', paddingTop: 10 }}>Sin movimientos en el período.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
