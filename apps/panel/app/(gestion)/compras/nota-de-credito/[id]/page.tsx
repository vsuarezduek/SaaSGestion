import Link from 'next/link';
import { notFound } from 'next/navigation';
import { aviso, tarjeta } from '../../../../../lib/estilos.ts';
import { obtenerNotaCreditoCompra } from '../../../../../lib/notasCreditoCompra.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../../packages/dominio/src/index.ts';
import AnularNotaCreditoCompra from './AnularNotaCreditoCompra.tsx';

export const dynamic = 'force-dynamic';
const NOMBRES: Record<string, string> = { nota_credito_a: 'Nota de crédito A', nota_credito_b: 'Nota de crédito B', sin_comprobante: 'Sin comprobante' };

export default async function DetalleNotaCreditoCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const n = await obtenerNotaCreditoCompra(s, id);
  if (!n) notFound();
  const $ = (v: string) => formatearPesos(aCentavos(v));
  const celda = { padding: '4px 6px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nota de crédito de proveedor N° {n.numero}{n.estado === 'anulada' ? ' (anulada)' : ''}</h1>
      <div style={tarjeta}>
        <div><b>Proveedor:</b> <Link href={`/proveedores/${n.proveedorId}`} style={{ color: '#1c9764' }}>{n.proveedor}</Link></div>
        <div><b>Fecha:</b> {n.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} · <b>Comprobante:</b> {NOMBRES[n.comprobante] ?? n.comprobante}{n.nroComprobante ? ` ${n.nroComprobante}` : ''}</div>
        {n.compraNumero !== null && <div><b>Referida a la compra N°</b> {n.compraNumero}</div>}
        {n.nota && <div><b>Nota:</b> {n.nota}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr><th style={celda}>Producto</th><th style={celda}>Cantidad</th><th style={celda}>Costo</th><th style={celda}>IVA</th><th style={celda}>Neto</th></tr></thead>
          <tbody>{n.renglones.map((r, i) => (<tr key={i}><td style={celda}>{r.descripcion}</td><td style={celda}>{formatearCantidad(r.cantidad)}</td><td style={celda}>{$(r.costo)}</td><td style={celda}>{Number(r.iva)}%</td><td style={celda}>{$(r.neto)}</td></tr>))}</tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          {Number(n.iva) > 0 && <div style={{ color: '#5c6d66', fontSize: 13 }}>Neto {$(n.neto)} · IVA {$(n.iva)}</div>}
          <div style={{ fontSize: 20 }}><b>Total {$(n.total)}</b></div>
        </div>
      </div>
      {n.estado === 'anulada' && <div style={aviso}>Anulada{n.motivoAnulacion ? `: ${n.motivoAnulacion}` : ''}. El stock y la deuda con el proveedor volvieron a su estado anterior.</div>}
      {n.estado === 'cerrada' && <AnularNotaCreditoCompra id={n.id} numero={n.numero} />}
    </main>
  );
}
