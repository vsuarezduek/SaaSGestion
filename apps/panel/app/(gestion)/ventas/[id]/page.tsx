import Link from 'next/link';
import { notFound } from 'next/navigation';
import { obtenerVenta } from '../../../../lib/ventas.ts';
import { aviso, boton, tarjeta } from '../../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../../lib/etiquetas.ts';
import AnularVenta from './AnularVenta.tsx';

export const dynamic = 'force-dynamic';

export default async function Venta({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ avisos?: string }> }) {
  const { id } = await params;
  const { avisos } = await searchParams;
  const s = await sesionObligatoria();
  const v = await obtenerVenta(s, id);
  if (!v) notFound();
  const $ = (n: string) => formatearPesos(aCentavos(n));
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const esNota = v.comprobante === 'nota_credito';
  const esFactura = v.comprobante === 'factura_a' || v.comprobante === 'factura_b';
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{esNota ? 'Nota de crédito' : 'Venta'} N° {v.numero}{v.estado === 'anulada' ? ' (anulada)' : ''}</h1>
      {avisos && <div style={{ ...aviso, background: '#fff4cc', color: '#8a6d00' }}>⚠ Stock negativo: {avisos}</div>}
      {v.estado === 'anulada' && (
        <div style={{ ...aviso, background: '#fbeae0', color: '#b4571a' }}>
          Venta anulada{v.anuladaEn ? ` el ${v.anuladaEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}` : ''}{v.motivoAnulacion ? ` · Motivo: ${v.motivoAnulacion}` : ''}. Sus movimientos de caja, stock y cuenta corriente fueron revertidos.
        </div>
      )}
      {esNota && v.origen && (
        <div style={aviso}>Devolución de la <Link href={`/ventas/${v.origen.id}`} style={{ color: '#1b5f63', fontWeight: 600 }}>venta N° {v.origen.numero}</Link>. {v.cobro === 'Cuenta corriente' ? 'Se descontó de la cuenta corriente del cliente.' : 'La plata salió de la caja.'}</div>
      )}
      {v.notasCredito.length > 0 && (
        <div style={aviso}>Notas de crédito de esta venta: {v.notasCredito.map((n, i) => (<span key={n.id}>{i > 0 ? ', ' : ''}<Link href={`/ventas/${n.id}`} style={{ color: '#1b5f63', fontWeight: 600 }}>N° {n.numero} ({$(n.total)})</Link></span>))}</div>
      )}
      <div style={tarjeta}>
        <div><b>Cliente:</b> <Link href={`/clientes/${v.clienteId}`} style={{ color: '#1c9764' }}>{v.cliente}</Link></div>
        <div><b>Fecha:</b> {v.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</div>
        <div><b>Comprobante:</b> {ETIQUETAS[v.comprobante] ?? v.comprobante}{v.nroComprobante ? ` N° ${v.nroComprobante}` : ''}</div>
        <div><b>{esNota ? 'Devolución:' : 'Cobro:'}</b> {v.cobro}{aCentavos(v.comision) > 0 ? ` (comisión ${$(v.comision)})` : ''}</div>
        {v.lista && <div><b>Lista de precios:</b> {v.lista}</div>}
        {v.usuario && <div><b>Cargó:</b> {v.usuario}</div>}
      </div>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Producto</th><th style={celda}>Cant.</th><th style={celda}>Precio</th><th style={celda}>Desc.</th>{esFactura && <th style={celda}>IVA</th>}<th style={celda}>Total</th></tr></thead>
          <tbody>
            {v.renglones.map((r, i) => (
              <tr key={i}>
                <td style={celda}>{r.descripcion}</td><td style={celda}>{formatearCantidad(r.cantidad)}</td><td style={celda}>{$(r.precio)}</td>
                <td style={celda}>{Number(r.descuentoPct) ? `${r.descuentoPct}%` : ''}</td>{esFactura && <td style={celda}>{Number(r.iva)}%</td>}<td style={celda}>{$(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          {aCentavos(v.descuentoTotal) > 0 && <div>Subtotal {$(v.subtotal)} · Descuento {v.descuentoPct}%: −{$(v.descuentoTotal)}</div>}
          <div style={{ fontSize: 20 }}><b>Total {$(v.total)}</b></div>
          {esFactura && <div style={{ color: '#5c6d66', fontSize: 13 }}>IVA incluido en el total: {$(v.ivaIncluido)}</div>}
        </div>
        {v.nota && <p style={{ fontSize: 14 }}><b>Nota:</b> {v.nota}</p>}
      </div>
      {v.estado === 'cerrada' && !esNota && <Link href={`/ventas/${v.id}/nota-de-credito`} style={{ ...boton, textDecoration: 'none', marginRight: 8 }}>Hacer nota de crédito</Link>}
      {v.estado === 'cerrada' && <AnularVenta id={v.id} numero={v.numero} esNota={esNota} />}
    </main>
  );
}
