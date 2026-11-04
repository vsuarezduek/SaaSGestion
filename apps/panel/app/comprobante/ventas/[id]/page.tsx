import { notFound } from 'next/navigation';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../../lib/etiquetas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { enlaceDeMail } from '../../../../lib/mail.ts';
import { obtenerConexion } from '../../../../lib/correo.ts';
import EnviarPorMail from '../../EnviarPorMail.tsx';
import { obtenerCliente } from '../../../../lib/personas.ts';
import { obtenerEmpresa } from '../../../../lib/empresa.ts';
import { obtenerVenta } from '../../../../lib/ventas.ts';
import EncabezadoEmpresa from '../../EncabezadoEmpresa.tsx';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import BotonImprimir from './BotonImprimir.tsx';

export const dynamic = 'force-dynamic';

/** Comprobante de una venta (o nota de crédito) listo para imprimir o guardar como PDF. En las facturas se detalla el IVA por alícuota. */
export default async function Comprobante({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [v, comercio, conexion] = await Promise.all([obtenerVenta(s, id), obtenerEmpresa(s), obtenerConexion(s)]);
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
  const cliente = v.clienteId ? await obtenerCliente(s, v.clienteId) : null;
  const titulo = `${esNota ? 'Nota de crédito' : 'Venta'} N° ${v.numero}`;
  const cuerpo = [
    `Hola${cliente ? ' ' + cliente.nombre : ''}, te mandamos el detalle de tu ${titulo.toLowerCase()} del ${v.fecha.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}:`, '',
    ...v.renglones.map((r) => `- ${formatearCantidad(r.cantidad)} x ${r.descripcion}: ${$(r.total)}`), '',
    `Total: ${$(v.total)}`, '', 'Gracias por tu compra.', comercio.nombre, comercio.telefono ?? '', comercio.email ?? '',
  ].join('\n').trim();
  const mail = enlaceDeMail({ para: cliente?.email, cc: comercio.email, asunto: `${titulo} - ${comercio.nombre}`, cuerpo });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #ccc', fontSize: 14, textAlign: 'left' as const };
  const der = { ...celda, textAlign: 'right' as const };
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24, background: '#fff', color: '#000', minHeight: '100vh' }}>
      <style>{'@media print { .no-imprimir { display: none !important; } body { background: #fff !important; } main { padding: 0 !important; } }'}</style>
      <div className="no-imprimir" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <BotonImprimir />
        {conexion ? (
          <EnviarPorMail tipo="venta" id={v.id} destino={cliente?.email ?? ''} cuenta={conexion.cuenta} />
        ) : (
          <>
            <a href={mail} style={{ color: '#1c9764', fontWeight: 600 }}>Enviar por mail</a>
            <span style={{ fontSize: 12, color: '#5c6d66' }}>Se abre tu programa de mail con el texto escrito{cliente?.email ? '' : ' (el cliente no tiene mail cargado)'}. Para enviarlo directo con el comprobante, conectá tu casilla en Ajustes → Correo.</span>
          </>
        )}
      </div>
      <EncabezadoEmpresa empresa={comercio} hijos={
        <div style={{ textAlign: 'right', fontSize: 14 }}>
          <div style={{ fontSize: 13 }}>{ETIQUETAS[v.comprobante] ?? v.comprobante}{v.nroComprobante ? ` N° ${v.nroComprobante}` : ''}</div>
          <div><b>{esNota ? 'Nota de crédito' : 'Venta'} N° {v.numero}</b>{v.estado === 'anulada' ? ' (ANULADA)' : ''}</div>
          <div>{v.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</div>
        </div>
      } />
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
