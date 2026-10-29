import Link from 'next/link';
import { notFound } from 'next/navigation';
import { aviso, tarjeta } from '../../../../lib/estilos.ts';
import { obtenerRecibo } from '../../../../lib/recibos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import AnularRecibo from './AnularRecibo.tsx';

export const dynamic = 'force-dynamic';

export default async function Recibo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const r = await obtenerRecibo(s, id);
  if (!r) notFound();
  const $ = (n: string) => formatearPesos(aCentavos(n));
  const hora = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  return (
    <main style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Recibo N° {r.numero}{r.estado === 'anulado' ? ' (anulado)' : ''}</h1>
      {r.estado === 'anulado' && (
        <div style={{ ...aviso, background: '#fbeae0', color: '#b4571a' }}>
          Recibo anulado{r.anuladoEn ? ` el ${hora(r.anuladoEn)}` : ''}{r.motivoAnulacion ? ` · Motivo: ${r.motivoAnulacion}` : ''}. El ingreso en caja y el pago en la cuenta corriente fueron revertidos.
        </div>
      )}
      <div style={tarjeta}>
        <div><b>Cliente:</b> <Link href={`/clientes/${r.clienteId}`} style={{ color: '#1c9764' }}>{r.cliente}</Link></div>
        <div><b>Fecha:</b> {hora(r.fecha)}</div>
        <div><b>Importe:</b> <span style={{ fontSize: 20 }}>{$(r.importe)}</span></div>
        <div><b>Cobro:</b> {r.cobro}{aCentavos(r.comision) > 0 ? ` (comisión ${$(r.comision)})` : ''}</div>
        {r.ventaId && <div><b>Corresponde a la venta:</b> <Link href={`/ventas/${r.ventaId}`} style={{ color: '#1c9764' }}>N° {r.ventaNumero}</Link></div>}
        {r.usuario && <div><b>Cargó:</b> {r.usuario}</div>}
        {r.nota && <p style={{ fontSize: 14 }}><b>Nota:</b> {r.nota}</p>}
      </div>
      {r.estado === 'cerrado' && <AnularRecibo id={r.id} numero={r.numero} />}
    </main>
  );
}
