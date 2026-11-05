'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../../lib/estilos.ts';
import type { ClienteParaVenta, ProductoParaVenta } from '../../../../../lib/ventas.ts';
import { aCentavos, calcularVenta, formatearPesos, normalizarCantidad } from '../../../../../../../packages/dominio/src/index.ts';
import { buscarClientesAccion, buscarProductosAccion, emitirNotaCreditoLibreAccion } from '../../acciones.ts';

interface Props {
  clienteInicial: ClienteParaVenta | null;
  medios: { id: string; nombre: string; cajaIds: string[] }[];
  cajas: { id: string; nombre: string }[];
}
interface Linea { productoId: string | null; descripcion: string; cantidad: string; precio: string; descuentoPct: string; iva: number }

/** Devolución sin venta de origen: quien la emite define el cliente, los productos y el precio al que se devuelve; no hay tope contra una venta anterior. */
export default function NotaCreditoLibre({ clienteInicial, medios, cajas }: Props) {
  const router = useRouter();
  const [clave] = useState(() => crypto.randomUUID());
  const [cliente, setCliente] = useState<ClienteParaVenta | null>(clienteInicial);
  const [qc, setQc] = useState('');
  const [resC, setResC] = useState<ClienteParaVenta[]>([]);
  const [qp, setQp] = useState('');
  const [resP, setResP] = useState<ProductoParaVenta[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cobroTipo, setCobroTipo] = useState<'caja' | 'cuenta_corriente'>('caja');
  const [medioId, setMedioId] = useState('');
  const [cajaId, setCajaId] = useState('');
  const [nota, setNota] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const turnoC = useRef(0);
  const turnoP = useRef(0);
  useEffect(() => {
    const mio = ++turnoC.current;
    if (qc.trim() === '') { setResC([]); return; }
    const t = setTimeout(async () => { const r = await buscarClientesAccion(qc); if (mio === turnoC.current) setResC(r); }, 200);
    return () => clearTimeout(t);
  }, [qc]);
  useEffect(() => {
    const mio = ++turnoP.current;
    if (qp.trim() === '') { setResP([]); return; }
    const t = setTimeout(async () => { const r = await buscarProductosAccion(qp, cliente?.listaId ?? null); if (mio === turnoP.current) setResP(r); }, 200);
    return () => clearTimeout(t);
  }, [qp, cliente]);

  const medio = medios.find((m) => m.id === medioId) ?? null;
  const cajasDelMedio = medio ? cajas.filter((c) => medio.cajaIds.includes(c.id)) : [];
  const calculo = (() => {
    try {
      if (lineas.length === 0) return null;
      return calcularVenta(lineas.map((l) => {
        const c = normalizarCantidad(l.cantidad);
        if (c === null || Number(c) <= 0) throw new Error('cantidad');
        return { cantidad: c, precio: aCentavos(l.precio || '0'), descuentoPct: Number(l.descuentoPct || '0'), iva: l.iva };
      }), 0);
    } catch { return null; }
  })();
  const cambiar = (i: number, p: Partial<Linea>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const agregar = (p: ProductoParaVenta | null) => {
    setLineas((ls) => [...ls, p ? { productoId: p.id, descripcion: p.nombre, cantidad: '1', precio: p.precio, descuentoPct: '0', iva: p.iva } : { productoId: null, descripcion: '', cantidad: '1', precio: '0', descuentoPct: '0', iva: 21 }]);
    setQp(''); setResP([]);
  };
  const emitir = () => iniciar(async () => {
    setMsg(null);
    const r = await emitirNotaCreditoLibreAccion({
      clave, clienteId: cliente?.id ?? '', fecha: '', nota,
      renglones: lineas.map((l) => ({ productoId: l.productoId, descripcion: l.productoId ? '' : l.descripcion, cantidad: l.cantidad, precio: l.precio, descuentoPct: Number(l.descuentoPct || '0'), iva: l.iva })),
      cobro: cobroTipo === 'cuenta_corriente' ? { tipo: 'cuenta_corriente' } : { tipo: 'caja', medioPagoId: medioId, cajaId },
    });
    if (r.error) setMsg(r.error); else router.push(`/ventas/${r.id}`);
  });
  const celda = { padding: '4px 6px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const entrada = { ...campo, marginTop: 0, padding: 6 };
  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={tarjeta}>
        {cliente ? (
          <div><b>Cliente:</b> {cliente.nombre} <button type="button" style={{ ...botonSecundario, padding: '2px 10px' }} onClick={() => { setCliente(null); setCobroTipo('caja'); }}>Cambiar</button></div>
        ) : (
          <>
            <label style={etiqueta}>Cliente
              <input style={campo} value={qc} placeholder="Buscar por nombre, CUIT o teléfono…" onChange={(e) => setQc(e.target.value)} />
            </label>
            {resC.map((c) => (
              <div key={c.id}><button type="button" style={{ ...botonSecundario, width: '100%', textAlign: 'left', marginBottom: 4 }} onClick={() => { setCliente(c); setQc(''); setResC([]); }}>{c.nombre}</button></div>
            ))}
          </>
        )}
        <p style={{ fontSize: 13, color: '#5c6d66', marginBottom: 0 }}>Para devolver algo que no sale de una venta cargada: elegí el producto y el precio al que se devuelve. El stock vuelve y la plata se devuelve desde una caja o se descuenta de la cuenta corriente. Para devolver de una venta puntual, hacé la nota desde esa venta.</p>
      </div>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <label style={etiqueta}>Agregar producto
          <input style={campo} value={qp} placeholder="Buscar por nombre o código…" onChange={(e) => setQp(e.target.value)} />
        </label>
        {resP.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 10px' }}>
            {resP.map((p) => (<li key={p.id}><button type="button" style={{ ...botonSecundario, width: '100%', textAlign: 'left' }} onClick={() => agregar(p)}>{p.nombre}{p.codigo ? ` · ${p.codigo}` : ''}</button></li>))}
          </ul>
        )}
        <button type="button" style={botonSecundario} onClick={() => agregar(null)}>+ Ítem libre (sin stock)</button>
        {lineas.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
            <thead><tr><th style={celda}>Producto</th><th style={celda}>Cantidad</th><th style={celda}>Precio</th><th style={celda}>Desc. %</th><th style={celda}>IVA %</th><th style={celda} /></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td style={celda}>{l.productoId ? l.descripcion : <input style={entrada} value={l.descripcion} maxLength={200} placeholder="Descripción" onChange={(e) => cambiar(i, { descripcion: e.target.value })} />}</td>
                  <td style={{ ...celda, width: 80 }}><input style={entrada} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} /></td>
                  <td style={{ ...celda, width: 110 }}><input style={entrada} inputMode="decimal" value={l.precio} onChange={(e) => cambiar(i, { precio: e.target.value })} /></td>
                  <td style={{ ...celda, width: 70 }}><input style={entrada} inputMode="decimal" value={l.descuentoPct} onChange={(e) => cambiar(i, { descuentoPct: e.target.value })} /></td>
                  <td style={{ ...celda, width: 80 }}>
                    <select style={entrada} value={l.iva} onChange={(e) => cambiar(i, { iva: Number(e.target.value) })}>{[0, 10.5, 21, 27].map((v) => (<option key={v} value={v}>{v}</option>))}</select>
                  </td>
                  <td style={celda}><button type="button" style={botonSecundario} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          <div style={{ fontSize: 22 }}><b>Total a devolver {calculo ? formatearPesos(calculo.total) : '—'}</b></div>
        </div>
      </div>
      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ ...etiqueta, flex: '1 1 200px', marginBottom: 0 }}>Cómo se devuelve
            <select style={campo} value={cobroTipo} onChange={(e) => setCobroTipo(e.target.value as 'caja' | 'cuenta_corriente')}>
              <option value="caja">Devolver el dinero desde una caja</option>
              {cliente?.cuentaCorriente && <option value="cuenta_corriente">Descontar de la cuenta corriente</option>}
            </select>
          </label>
          {cobroTipo === 'caja' && (
            <>
              <label style={{ ...etiqueta, flex: '1 1 160px', marginBottom: 0 }}>Medio de pago
                <select style={campo} value={medioId} onChange={(e) => { setMedioId(e.target.value); setCajaId(''); }}>
                  <option value="">Elegir…</option>{medios.map((m) => (<option key={m.id} value={m.id}>{m.nombre}</option>))}
                </select>
              </label>
              <label style={{ ...etiqueta, flex: '1 1 160px', marginBottom: 0 }}>Caja
                <select style={campo} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                  <option value="">Elegir…</option>{cajasDelMedio.map((c) => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
                </select>
              </label>
              {medio && cajasDelMedio.length === 0 && <span style={{ color: '#b4571a', fontSize: 13 }}>No hay cajas abiertas habilitadas para este medio.</span>}
            </>
          )}
          <label style={{ ...etiqueta, flex: '3 1 240px', marginBottom: 0 }}>Nota<input style={campo} value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" style={{ ...boton, fontSize: 16, padding: '12px 20px' }} disabled={pend || !cliente || !calculo || (cobroTipo === 'caja' && (!medioId || !cajaId))} onClick={emitir}>{pend ? 'Emitiendo…' : 'Emitir nota de crédito'}</button>{' '}
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => router.back()}>Cancelar</button>
        </div>
      </div>
    </>
  );
}
