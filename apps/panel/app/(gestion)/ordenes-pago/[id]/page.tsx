import Link from 'next/link';
import { notFound } from 'next/navigation';
import { aviso, tarjeta } from '../../../../lib/estilos.ts';
import { obtenerOrdenPago } from '../../../../lib/ordenesPago.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import AnularOrdenPago from './AnularOrdenPago.tsx';

export const dynamic = 'force-dynamic';

export default async function OrdenPago({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const o = await obtenerOrdenPago(s, id);
  if (!o) notFound();
  const $ = (n: string) => formatearPesos(aCentavos(n));
  const hora = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  return (
    <main style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Orden de pago N° {o.numero}{o.estado === 'anulada' ? ' (anulada)' : ''}</h1>
      {o.estado === 'anulada' && (
        <div style={{ ...aviso, background: '#fbeae0', color: '#b4571a' }}>
          Orden anulada{o.anuladaEn ? ` el ${hora(o.anuladaEn)}` : ''}{o.motivoAnulacion ? ` · Motivo: ${o.motivoAnulacion}` : ''}. El egreso de caja y el pago en la cuenta corriente fueron revertidos.
        </div>
      )}
      <div style={tarjeta}>
        <div><b>Proveedor:</b> <Link href={`/proveedores/${o.proveedorId}`} style={{ color: '#1c9764' }}>{o.proveedor}</Link></div>
        <div><b>Fecha:</b> {hora(o.fecha)}</div>
        <div><b>Importe:</b> <span style={{ fontSize: 20 }}>{$(o.importe)}</span></div>
        <div><b>Pagado desde:</b> {o.caja}{aCentavos(o.impuesto) > 0 ? ` (impuesto por transacción ${$(o.impuesto)})` : ''}</div>
        {o.compraId && <div><b>Corresponde a la compra:</b> <Link href={`/compras/${o.compraId}`} style={{ color: '#1c9764' }}>N° {o.compraNumero}</Link></div>}
        {o.usuario && <div><b>Cargó:</b> {o.usuario}</div>}
        {o.nota && <p style={{ fontSize: 14 }}><b>Nota:</b> {o.nota}</p>}
      </div>
      {o.estado === 'cerrada' && <AnularOrdenPago id={o.id} numero={o.numero} />}
    </main>
  );
}
