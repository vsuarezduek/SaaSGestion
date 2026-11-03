import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detalleDeCierre } from '../../../../../lib/cajas.ts';
import { botonSecundario, tarjeta } from '../../../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

const TIPOS: Record<string, string> = {
  ingreso: 'Ingreso', egreso: 'Egreso', transferencia_salida: 'Transferencia', transferencia_entrada: 'Transferencia', apertura_diferencia: 'Dif. apertura',
  cierre_diferencia: 'Dif. cierre', traspaso_salida: 'Traspaso', traspaso_entrada: 'Traspaso', reversion: 'Anulación',
};

export default async function DetalleCierre({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const d = await detalleDeCierre(s, id);
  if (!d) notFound();
  const $ = (n: string) => formatearPesos(aCentavos(n));
  const fecha = (x: Date) => new Date(x).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const fila = (t: string, v: string, rojo = false) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 14, color: rojo ? '#b4571a' : undefined }}><span>{t}</span><b>{v}</b></div>;
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <p style={{ margin: 0 }}><Link href="/cajas/cierres" style={{ color: '#1c9764' }}>← Historial de cierres</Link></p>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Cierre de {d.caja}</h1>
      <p style={{ color: '#5c6d66', marginTop: 0 }}>{fecha(d.abiertoEn)} → {fecha(d.cerradoEn)}</p>
      {d.reabreTurnoId && <div style={{ ...tarjeta, borderColor: '#f0c36b', background: '#fffaf0' }}>Turno reabierto por {d.reabiertoPor ?? 'administración'}. Motivo: {d.reaperturaMotivo}. <Link href={`/cajas/cierres/${d.reabreTurnoId}`} style={{ color: '#1c9764' }}>Ver el cierre anterior</Link></div>}
      {d.reabierto && <div style={{ ...tarjeta, borderColor: '#f0c36b', background: '#fffaf0' }}>Este cierre fue reabierto el mismo día; sus diferencias y traspaso se anularon.</div>}
      <div style={tarjeta}>
        <b>Apertura</b>
        {fila('Abrió', d.abiertoPor ?? '–')}{fila('Esperado', $(d.aperturaEsperada))}{fila('Contado', $(d.aperturaContada))}
        <b style={{ display: 'block', marginTop: 10 }}>Durante el turno</b>
        {fila('Ingresos', $(d.ingresos))}{fila('Egresos', $(d.egresos))}
        <b style={{ display: 'block', marginTop: 10 }}>Cierre</b>
        {fila('Cerró', d.usuario ?? '–')}{fila('Esperado', $(d.cierreEsperado))}{fila('Contado', $(d.cierreContado))}
        {fila('Diferencia', $(d.diferencia), Number(d.diferencia) < 0)}{fila('Dejado de cambio', $(d.cambioDejado))}
        {d.traspaso && fila('Traspasado', `${$(d.traspaso)} → ${d.destino}`)}
      </div>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <b>Movimientos del turno ({d.movimientos.length})</b>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Hora</th><th style={celda}>Tipo</th><th style={celda}>Concepto</th><th style={celda}>Importe</th><th style={celda}>Usuario</th></tr></thead>
          <tbody>
            {d.movimientos.map((m) => (
              <tr key={m.id} style={{ opacity: m.revertido ? 0.5 : 1 }}>
                <td style={celda}>{fecha(m.fecha)}</td><td style={celda}>{TIPOS[m.tipo] ?? m.tipo}{m.revertido ? ' (anulado)' : ''}</td>
                <td style={celda}>{m.origen ? <Link href={m.origen} style={{ color: '#1c9764' }}>{m.concepto || 'Ver detalle'}</Link> : (m.concepto ?? '')}</td><td style={celda}>{$(m.importe)}</td><td style={celda}>{m.usuario ?? ''}</td>
              </tr>
            ))}
            {d.movimientos.length === 0 && <tr><td style={celda} colSpan={5}>Sin movimientos en este turno.</td></tr>}
          </tbody>
        </table>
      </div>
      <a href={`/comprobante/cierre/${d.id}`} target="_blank" style={{ ...botonSecundario, textDecoration: 'none' }}>Imprimir / Guardar como PDF</a>
    </main>
  );
}
