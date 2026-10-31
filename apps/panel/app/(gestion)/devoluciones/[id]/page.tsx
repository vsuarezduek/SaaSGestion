import Link from 'next/link';
import { notFound } from 'next/navigation';
import { obtenerDevolucion } from '../../../../lib/devoluciones.ts';
import { aviso, tarjeta } from '../../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import AnularDevolucion from './AnularDevolucion.tsx';

export const dynamic = 'force-dynamic';

export default async function Devolucion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const d = await obtenerDevolucion(s, id);
  if (!d) notFound();
  const hora = (f: Date) => f.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  return (
    <main style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Devolución de pago N° {d.numero}{d.estado === 'anulada' ? ' (anulada)' : ''}</h1>
      {d.estado === 'anulada' && (
        <div style={{ ...aviso, background: '#fbeae0', color: '#b4571a' }}>
          Devolución anulada{d.anuladaEn ? ` el ${hora(d.anuladaEn)}` : ''}{d.motivoAnulacion ? ` · Motivo: ${d.motivoAnulacion}` : ''}. El egreso de caja y el movimiento de cuenta corriente fueron revertidos.
        </div>
      )}
      <div style={tarjeta}>
        <div><b>Cliente:</b> <Link href={`/clientes/${d.clienteId}`} style={{ color: '#1c9764' }}>{d.cliente}</Link></div>
        <div><b>Fecha:</b> {hora(d.fecha)}</div>
        <div><b>Importe devuelto:</b> <span style={{ fontSize: 20 }}>{formatearPesos(aCentavos(d.importe))}</span></div>
        <div><b>Salió de:</b> {d.cobro}</div>
        {d.usuario && <div><b>Cargó:</b> {d.usuario}</div>}
        {d.nota && <p style={{ fontSize: 14 }}><b>Nota:</b> {d.nota}</p>}
      </div>
      {d.estado === 'cerrada' && <AnularDevolucion id={d.id} numero={d.numero} />}
    </main>
  );
}
