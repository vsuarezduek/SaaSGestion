import Link from 'next/link';
import { notFound } from 'next/navigation';
import { obtenerCompra } from '../../../../lib/compras.ts';
import { aviso, boton, tarjeta } from '../../../../lib/estilos.ts';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../../lib/etiquetas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import AnularCompra from './AnularCompra.tsx';

export const dynamic = 'force-dynamic';
const MODOS: Record<string, string> = { ninguno: 'No actualizar costos', costo: 'Actualizar costo, no modificar precio', costo_y_precio: 'Actualizar costo y mantener rentabilidad' };

export default async function Compra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const c = await obtenerCompra(s, id);
  if (!c) notFound();
  const $ = (n: string) => formatearPesos(aCentavos(n));
  const hora = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const esFactura = c.comprobante === 'factura_a' || c.comprobante === 'factura_b';
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Compra N° {c.numero}{c.estado === 'anulada' ? ' (anulada)' : ''}</h1>
      {c.estado === 'anulada' && (
        <div style={{ ...aviso, background: '#fbeae0', color: '#b4571a' }}>
          Compra anulada{c.anuladaEn ? ` el ${hora(c.anuladaEn)}` : ''}{c.motivoAnulacion ? ` · Motivo: ${c.motivoAnulacion}` : ''}. Sus movimientos de caja, stock y cuenta corriente fueron revertidos.
        </div>
      )}
      <div style={tarjeta}>
        <div><b>Proveedor:</b> <Link href={`/proveedores/${c.proveedorId}`} style={{ color: '#1c9764' }}>{c.proveedor}</Link></div>
        <div><b>Fecha:</b> {hora(c.fecha)}</div>
        <div><b>Comprobante:</b> {ETIQUETAS[c.comprobante] ?? c.comprobante}{c.nroComprobante ? ` N° ${c.nroComprobante}` : ''} · <b>Categoría:</b> {c.categoria}</div>
        <div><b>Pago:</b> {c.pago === 'Cuenta corriente' ? 'Cuenta corriente (se pagó $ 0)' : `Desde la caja ${c.pago}`}{aCentavos(c.impuesto) > 0 ? ` (impuesto por transacción ${$(c.impuesto)})` : ''}</div>
        <div><b>Costos y precios:</b> {MODOS[c.modoCostos] ?? c.modoCostos}</div>
        {c.usuario && <div><b>Registró:</b> {c.usuario}</div>}
      </div>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Producto</th><th style={celda}>Cant.</th><th style={celda}>Costo</th><th style={celda}>Desc.</th>{esFactura && <th style={celda}>IVA</th>}<th style={celda}>Neto</th></tr></thead>
          <tbody>
            {c.renglones.map((r, i) => (
              <tr key={i}>
                <td style={celda}>{r.descripcion}</td><td style={celda}>{formatearCantidad(r.cantidad)}</td><td style={celda}>{$(r.costo)}</td>
                <td style={celda}>{Number(r.descuentoPct) ? `${r.descuentoPct}%` : ''}</td>{esFactura && <td style={celda}>{Number(r.iva)}%</td>}<td style={celda}>{$(r.neto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          {aCentavos(c.descuentoTotal) > 0 && <div>Subtotal {$(c.subtotal)} · Descuento {c.descuentoPct}%: −{$(c.descuentoTotal)}</div>}
          {esFactura && <div style={{ color: '#5c6d66', fontSize: 13 }}>Neto gravado {$(c.neto)} · IVA {$(c.iva)}</div>}
          <div style={{ fontSize: 20 }}><b>Total {$(c.total)}</b></div>
        </div>
        {c.nota && <p style={{ fontSize: 14 }}><b>Nota:</b> {c.nota}</p>}
      </div>
      {c.ordenesPago.length > 0 && (
        <div style={aviso}>Órdenes de pago de esta compra: {c.ordenesPago.map((o, i) => (<span key={o.id}>{i > 0 ? ', ' : ''}<Link href={`/ordenes-pago/${o.id}`} style={{ color: '#1b5f63', fontWeight: 600 }}>N° {o.numero} ({$(o.importe)}{o.estado === 'anulada' ? ', anulada' : ''})</Link></span>))}</div>
      )}
      {c.estado === 'cerrada' && <Link href={`/compras/nueva?editar=${c.id}`} style={{ ...boton, textDecoration: 'none', marginRight: 8 }}>Editar</Link>}
      {c.estado === 'cerrada' && <AnularCompra id={c.id} numero={c.numero} />}
    </main>
  );
}
