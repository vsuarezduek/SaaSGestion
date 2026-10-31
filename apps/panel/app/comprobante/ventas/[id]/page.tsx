import { notFound } from 'next/navigation';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../../lib/etiquetas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { nombreDelComercio, obtenerVenta } from '../../../../lib/ventas.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import BotonImprimir from './BotonImprimir.tsx';

export const dynamic = 'force-dynamic';

/** Comprobante de una venta (o nota de crédito) listo para imprimir o guardar como PDF. En las facturas se detalla el IVA por alícuota. */
export default async function Comprobante({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [v, comercio] = await Promise.all([obtenerVenta(s, id), nombreDelComercio(s)]);
  if (!v) notFound();
  const $ = (n: string | number) => formatearPesos(typeof n === 'number' ? n : aCentavos(n));
  const esNota = v.comprobante === 'nota_credito';
  const esFactura = v.comprobante === 'factura_a' || v.comprobante === 'factura_b';
  // Neto gravado e IVA por alícuota (los importes ya incluyen el IVA).
  const porAlicuota = new Map<number, { neto: number; iva: number }>();
  for (const r of v.renglones) {
    const a = Number(r.iva);
    const x = porAlicuota.get(a) ?? { neto: 0, iva: 0 };
    x.iva += aCentavos(r.ivaIncluido);
    x.neto += aCentavos(r.total) - aCentavos(r.ivaIncluido);
    porAlicuota.set(a, x);
  }
  const celda = { padding: '6px 8px', borderBottom: '1px solid #ccc', fontSize: 14, textAlign: 'left' as const };
  const der = { ...celda, textAlign: 'right' as const };
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24, background: '#fff', color: '#000', minHeight: '100vh' }}>
      <style>{'@media print { .no-imprimir { display: none !important; } body { background: #fff !important; } main { padding: 0 !important; } }'}</style>
      <div className="no-imprimir" style={{ marginBottom: 16 }}><BotonImprimir /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 24, fontFamily: 'Georgia, serif' }}><b>{comercio}</b></div>
          <div style={{ fontSize: 13 }}>{ETIQUETAS[v.comprobante] ?? v.comprobante}{v.nroComprobante ? ` N° ${v.nroComprobante}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 14 }}>
          <div><b>{esNota ? 'Nota de crédito' : 'Venta'} N° {v.numero}</b>{v.estado === 'anulada' ? ' (ANULADA)' : ''}</div>
          <div>{v.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</div>
        </div>
      </div>
      <div style={{ margin: '12px 0', fontSize: 14 }}>
        <div><b>Cliente:</b> {v.cliente}</div>
        {esNota && v.origen && <div><b>Por la venta N°:</b> {v.origen.numero}</div>}
        <div><b>{esNota ? 'Devolución' : 'Forma de pago'}:</b> {v.cobro}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={celda}>Producto</th><th style={der}>Cant.</th><th style={der}>Precio</th><th style={der}>Desc.</th>{esFactura && <th style={der}>IVA</th>}<th style={der}>Importe</th></tr></thead>
        <tbody>
          {v.renglones.map((r, i) => (
            <tr key={i}>
              <td style={celda}>{r.descripcion}</td><td style={der}>{formatearCantidad(r.cantidad)}</td><td style={der}>{$(r.precio)}</td>
              <td style={der}>{Number(r.descuentoPct) ? `${Number(r.descuentoPct)}%` : ''}</td>{esFactura && <td style={der}>{Number(r.iva)}%</td>}<td style={der}>{$(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ textAlign: 'right', marginTop: 12, fontSize: 14 }}>
        {aCentavos(v.descuentoTotal) > 0 && <div>Subtotal {$(v.subtotal)} · Descuento: −{$(v.descuentoTotal)}</div>}
        {esFactura && [...porAlicuota.entries()].sort((a, b) => a[0] - b[0]).map(([a, x]) => (
          <div key={a}>Neto gravado {a}%: {$(x.neto)} · IVA {a}%: {$(x.iva)}</div>
        ))}
        <div style={{ fontSize: 22, marginTop: 6 }}><b>{esNota ? 'Total devuelto' : 'Total'} {$(v.total)}</b></div>
        {esFactura && <div style={{ fontSize: 12 }}>IVA incluido en el total: {$(v.ivaIncluido)}</div>}
      </div>
      {v.nota && <p style={{ fontSize: 13 }}><b>Nota:</b> {v.nota}</p>}
      {v.comprobante !== 'sin_comprobante' && esFactura && <p style={{ fontSize: 11, color: '#555' }}>Comprobante interno: la factura electrónica con CAE se emite al integrar la facturación (ARCA).</p>}
    </main>
  );
}
