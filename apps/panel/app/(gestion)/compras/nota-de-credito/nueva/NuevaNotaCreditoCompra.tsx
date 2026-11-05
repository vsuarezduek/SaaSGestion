'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../../lib/estilos.ts';
import type { DatosParaNotaCreditoCompra } from '../../../../../lib/notasCreditoCompra.ts';
import type { ProductoParaCompra } from '../../../../../lib/compras.ts';
import { aCentavos, calcularCompra, formatearPesos, normalizarCantidad } from '../../../../../../../packages/dominio/src/index.ts';
import { buscarProductosCompraAccion, emitirNotaCreditoCompraAccion } from '../../acciones.ts';

interface Linea { productoId: string | null; descripcion: string; cantidad: string; costo: string; iva: number }
const COMPROBANTES: [string, string][] = [['sin_comprobante', 'Sin comprobante'], ['nota_credito_a', 'Nota de crédito A'], ['nota_credito_b', 'Nota de crédito B']];

/** Devolución de mercadería a un proveedor: siempre baja lo que se le debe (cuenta corriente) y el stock; no mueve caja. */
export default function NuevaNotaCreditoCompra({ datos }: { datos: DatosParaNotaCreditoCompra }) {
  const router = useRouter();
  const [clave] = useState(() => crypto.randomUUID());
  const [lineas, setLineas] = useState<Linea[]>(() => datos.renglones.map((r) => ({ productoId: r.productoId, descripcion: r.descripcion, cantidad: r.cantidad, costo: r.costo, iva: r.iva })));
  const [comprobante, setComprobante] = useState('sin_comprobante');
  const [nro, setNro] = useState('');
  const [nota, setNota] = useState('');
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ProductoParaCompra[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const turno = useRef(0);
  useEffect(() => {
    const mio = ++turno.current;
    if (q.trim() === '') { setRes([]); return; }
    const t = setTimeout(async () => { const r = await buscarProductosCompraAccion(q); if (mio === turno.current) setRes(r); }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const conIva = comprobante !== 'sin_comprobante';
  const calculo = (() => {
    try {
      if (lineas.length === 0) return null;
      return calcularCompra(lineas.map((l) => {
        const c = normalizarCantidad(l.cantidad);
        if (c === null || Number(c) <= 0) throw new Error('cantidad');
        return { cantidad: c, costo: aCentavos(l.costo || '0'), descuentoPct: 0, iva: l.iva };
      }), 0, conIva);
    } catch { return null; }
  })();
  const cambiar = (i: number, p: Partial<Linea>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const agregar = (p: ProductoParaCompra | null) => {
    setLineas((ls) => [...ls, p ? { productoId: p.id, descripcion: p.nombre, cantidad: '1', costo: p.costo, iva: p.iva } : { productoId: null, descripcion: '', cantidad: '1', costo: '0', iva: 0 }]);
    setQ(''); setRes([]);
  };
  const emitir = () => iniciar(async () => {
    setMsg(null);
    const r = await emitirNotaCreditoCompraAccion({
      clave, proveedorId: datos.proveedor.id, compraOrigenId: datos.compra?.id ?? null, comprobante, nroComprobante: nro, fecha: '', nota,
      renglones: lineas.map((l) => ({ productoId: l.productoId, descripcion: l.productoId ? '' : l.descripcion, cantidad: l.cantidad, costo: l.costo, iva: l.iva })),
    });
    if (r.error) setMsg(r.error); else router.push(`/compras/nota-de-credito/${r.id}`);
  });
  const celda = { padding: '4px 6px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={tarjeta}>
        <div><b>Proveedor:</b> {datos.proveedor.nombre}{datos.compra ? ` · referida a la compra N° ${datos.compra.numero}` : ''}</div>
        <p style={{ fontSize: 13, color: '#5c6d66', marginBottom: 0 }}>Se devuelve mercadería al proveedor: sale del stock y baja lo que se le debe (cuenta corriente). No se mueve ninguna caja.</p>
      </div>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <label style={etiqueta}>Agregar producto
          <input style={campo} value={q} placeholder="Buscar por nombre o código…" onChange={(e) => setQ(e.target.value)} />
        </label>
        {res.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 10px' }}>
            {res.map((p) => (<li key={p.id}><button type="button" style={{ ...botonSecundario, width: '100%', textAlign: 'left' }} onClick={() => agregar(p)}>{p.nombre}{p.codigo ? ` · ${p.codigo}` : ''}</button></li>))}
          </ul>
        )}
        <button type="button" style={botonSecundario} onClick={() => agregar(null)}>+ Ítem libre (sin stock)</button>
        {lineas.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
            <thead><tr><th style={celda}>Producto</th><th style={celda}>Cantidad</th><th style={celda}>Costo (sin IVA)</th><th style={celda}>IVA %</th><th style={celda} /></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td style={celda}>{l.productoId ? l.descripcion : <input style={{ ...campo, marginTop: 0, padding: 6 }} value={l.descripcion} maxLength={200} placeholder="Descripción" onChange={(e) => cambiar(i, { descripcion: e.target.value })} />}</td>
                  <td style={{ ...celda, width: 90 }}><input style={{ ...campo, marginTop: 0, padding: 6 }} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} /></td>
                  <td style={{ ...celda, width: 120 }}><input style={{ ...campo, marginTop: 0, padding: 6 }} inputMode="decimal" value={l.costo} onChange={(e) => cambiar(i, { costo: e.target.value })} /></td>
                  <td style={{ ...celda, width: 90 }}>
                    <select style={{ ...campo, marginTop: 0, padding: 6 }} value={l.iva} onChange={(e) => cambiar(i, { iva: Number(e.target.value) })}>
                      {[0, 10.5, 21, 27].map((v) => (<option key={v} value={v}>{v}</option>))}
                    </select>
                  </td>
                  <td style={celda}><button type="button" style={botonSecundario} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          {calculo && conIva && <div style={{ color: '#5c6d66', fontSize: 13 }}>Neto {formatearPesos(calculo.neto)} · IVA {formatearPesos(calculo.iva)}</div>}
          <div style={{ fontSize: 22 }}><b>Total a descontar {calculo ? formatearPesos(calculo.total) : '—'}</b></div>
        </div>
      </div>
      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ ...etiqueta, flex: '1 1 180px', marginBottom: 0 }}>Comprobante
            <select style={campo} value={comprobante} onChange={(e) => setComprobante(e.target.value)}>{COMPROBANTES.map(([v, n]) => (<option key={v} value={v}>{n}</option>))}</select>
          </label>
          <label style={{ ...etiqueta, flex: '1 1 160px', marginBottom: 0 }}>N° del comprobante<input style={campo} value={nro} maxLength={30} onChange={(e) => setNro(e.target.value)} /></label>
          <label style={{ ...etiqueta, flex: '3 1 240px', marginBottom: 0 }}>Nota<input style={campo} value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" style={{ ...boton, fontSize: 16, padding: '12px 20px' }} disabled={pend || !calculo} onClick={emitir}>{pend ? 'Emitiendo…' : 'Emitir nota de crédito'}</button>{' '}
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => router.back()}>Cancelar</button>
        </div>
      </div>
    </>
  );
}
