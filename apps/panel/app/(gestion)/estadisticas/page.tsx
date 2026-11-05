import { redirect } from 'next/navigation';
import Link from 'next/link';
import { formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { botonSecundario, campo, error, pagina, tarjeta } from '../../../lib/estilos.ts';
import { estadisticasDe, periodoDe, type OrdenProductos } from '../../../lib/estadisticas.ts';
import { sesionActual } from '../../../lib/sesion.ts';
import BotonPng from './BotonPng.tsx';
import Pestanas from './Pestanas.tsx';
import Grafico, { valorTexto } from './Grafico.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const OPCIONES = [['hoy', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mes_anterior', 'Mes anterior'], ['anio', 'Este año']] as const;

export default async function Estadisticas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sesion = await sesionActual();
  if (!sesion) redirect('/ingresar');
  const q = await searchParams;
  const orden: OrdenProductos = q.orden === 'unidades' || q.orden === 'rentabilidad' ? q.orden : 'monto';
  let datos, problema = '';
  try {
    datos = await estadisticasDe(sesion, periodoDe(q.p, q.desde, q.hasta), orden);
  } catch (e) {
    if (!(e instanceof ErrorDeUsuario)) throw e;
    problema = e.message;
  }
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <main style={{ ...pagina, maxWidth: 760 }}>
      <h1 style={{ marginTop: 0 }}>Estadísticas</h1>
      <Pestanas activa="graficos" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {OPCIONES.map(([clave, texto]) => (
          <Link key={clave} href={`/estadisticas?p=${clave}`} style={{ ...botonSecundario, textDecoration: 'none', padding: '6px 10px', ...((q.p ?? 'mes') === clave && !q.desde ? { background: '#1c9764', color: '#fff' } : {}) }}>{texto}</Link>
        ))}
      </div>
      <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: '#5c6d66' }}>Desde<input type="date" name="desde" defaultValue={q.desde} style={{ ...campo, width: 'auto' }} /></label>
        <label style={{ fontSize: 12, color: '#5c6d66' }}>Hasta<input type="date" name="hasta" defaultValue={q.hasta} style={{ ...campo, width: 'auto' }} /></label>
        <label style={{ fontSize: 12, color: '#5c6d66' }}>Top productos por
          <select name="orden" defaultValue={orden} style={{ ...campo, width: 'auto' }}>
            <option value="monto">Monto</option><option value="unidades">Unidades</option><option value="rentabilidad">Rentabilidad</option>
          </select>
        </label>
        <button style={{ ...botonSecundario, padding: '9px 14px' }}>Ver</button>
      </form>
      {problema && <p style={error}>{problema}</p>}
      {datos && (
        <>
          <p style={{ color: '#5c6d66', marginTop: 0 }}>{datos.periodo.nombre}: {datos.periodo.desde} al {datos.periodo.hasta}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
            {([['Ventas', formatearPesos(datos.ventas)], ['Operaciones', String(datos.operaciones)], ['Ticket promedio', formatearPesos(datos.ticketPromedio)], ['Rentabilidad estimada', formatearPesos(datos.rentabilidad)], ['Compras', formatearPesos(datos.compras)]] as const).map(([t, v]) => (
              <div key={t} style={{ ...tarjeta, marginBottom: 0, padding: 12 }}><div style={{ fontSize: 12, color: '#5c6d66' }}>{t}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div></div>
            ))}
          </div>
          <p style={{ display: 'flex', gap: 8 }}>
            <a href={`/estadisticas/csv?${params}`} style={{ ...botonSecundario, textDecoration: 'none' }}>Descargar todo (CSV)</a>
          </p>
          {datos.series.map((s) => (
            <details key={s.clave} open={['tiempo', 'medio', 'productos'].includes(s.clave)} style={tarjeta}>
              <summary style={{ fontWeight: 600, cursor: 'pointer' }}>{s.titulo}</summary>
              <div style={{ marginTop: 10 }}>
                <Grafico serie={s} />
                {s.nota && <p style={{ fontSize: 12, color: '#5c6d66', margin: '6px 0 0' }}>{s.nota}</p>}
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, color: '#5c6d66', cursor: 'pointer' }}>Ver como tabla</summary>
                  <table style={{ width: '100%', fontSize: 13, marginTop: 6 }}>
                    <tbody>{s.puntos.map((p, i) => <tr key={i}><td>{p.etiqueta}</td><td style={{ textAlign: 'right' }}>{valorTexto(p.valor, s.formato)}</td></tr>)}</tbody>
                  </table>
                </details>
                <a href={`/estadisticas/csv?${params}&serie=${s.clave}`} style={{ fontSize: 12 }}>CSV de este gráfico</a>
                <BotonPng nombre={`${s.clave}-${datos.periodo.desde}_${datos.periodo.hasta}`} />
              </div>
            </details>
          ))}
        </>
      )}
    </main>
  );
}
