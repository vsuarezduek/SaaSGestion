import { notFound } from 'next/navigation';
import { detalleDeCierre } from '../../../../lib/cajas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { obtenerEmpresa } from '../../../../lib/empresa.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import BotonImprimir from '../../listas/BotonImprimir.tsx';

export const dynamic = 'force-dynamic';

const TIPOS: Record<string, string> = {
  ingreso: 'Ingreso', egreso: 'Egreso', transferencia_salida: 'Transferencia', transferencia_entrada: 'Transferencia', apertura_diferencia: 'Dif. apertura',
  cierre_diferencia: 'Dif. cierre', traspaso_salida: 'Traspaso', traspaso_entrada: 'Traspaso', reversion: 'Anulación',
};

/** Cierre de caja para imprimir o guardar como PDF desde el navegador. */
export default async function ComprobanteCierre({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [d, comercio] = await Promise.all([detalleDeCierre(s, id), obtenerEmpresa(s)]);
  if (!d) notFound();
  const $ = (n: string) => formatearPesos(aCentavos(n));
  const fecha = (x: Date) => new Date(x).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const celda = { padding: '4px 8px', borderBottom: '1px solid #ccc', fontSize: 13, textAlign: 'left' as const };
  const fila = (t: string, v: string) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 14 }}><span>{t}</span><b>{v}</b></div>;
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <style>{'@media print { .no-imprimir { display: none !important; } body { background: #fff !important; } main { padding: 0 !important; } }'}</style>
      <p className="no-imprimir"><BotonImprimir /></p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: `3px solid ${comercio.color}`, paddingBottom: 8 }}>
        {comercio.tieneLogo && <img src="/empresa/logo" alt="" style={{ maxHeight: 60, maxWidth: 140 }} />}
        <h1 style={{ fontFamily: 'Georgia, serif', margin: 0 }}>{comercio.nombre}</h1>
      </div>
      <h2 style={{ marginTop: 4 }}>Cierre de {d.caja}</h2>
      <p style={{ marginTop: 0 }}>{fecha(d.abiertoEn)} → {fecha(d.cerradoEn)}</p>
      {d.reaperturaMotivo && <p>Turno reabierto. Motivo: {d.reaperturaMotivo}</p>}
      {fila('Abrió', d.abiertoPor ?? '–')}{fila('Apertura esperada', $(d.aperturaEsperada))}{fila('Apertura contada', $(d.aperturaContada))}
      {fila('Ingresos del turno', $(d.ingresos))}{fila('Egresos del turno', $(d.egresos))}
      {fila('Cerró', d.usuario ?? '–')}{fila('Cierre esperado', $(d.cierreEsperado))}{fila('Cierre contado', $(d.cierreContado))}
      {fila('Diferencia', $(d.diferencia))}{fila('Dejado de cambio', $(d.cambioDejado))}{d.traspaso && fila('Traspasado', `${$(d.traspaso)} → ${d.destino}`)}
      <h3>Movimientos</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={celda}>Hora</th><th style={celda}>Tipo</th><th style={celda}>Concepto</th><th style={celda}>Importe</th></tr></thead>
        <tbody>{d.movimientos.map((m) => <tr key={m.id}><td style={celda}>{fecha(m.fecha)}</td><td style={celda}>{TIPOS[m.tipo] ?? m.tipo}{m.revertido ? ' (anulado)' : ''}</td><td style={celda}>{m.concepto ?? ''}</td><td style={celda}>{$(m.importe)}</td></tr>)}</tbody>
      </table>
    </main>
  );
}
