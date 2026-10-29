'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { aCentavos, calcularVenta, comisionDeCobro, deCentavos, formatearCantidad, formatearPesos, normalizarCantidad, normalizarImporte } from '../../../../../../packages/dominio/src/index.ts';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { buscarClientesAccion, buscarProductosAccion, cerrarVentaAccion } from '../acciones.ts';

interface Cliente { id: string; nombre: string; saldo: string; listaId: string | null; descuento: number; cuentaCorriente: boolean; esConsumidorFinal: boolean }
interface Producto { id: string; nombre: string; codigo: string | null; unidad: string; precio: string; iva: number; stock: string }
interface Renglon { clave: number; productoId: string | null; descripcion: string; cantidad: string; precio: string; descuentoPct: string; iva: number; stock: string | null }
interface Props {
  listas: { id: string; nombre: string }[];
  medios: { id: string; nombre: string; comisionPct: number; ivaComision: number; cajaIds: string[] }[];
  cajas: { id: string; nombre: string }[];
  clienteInicial: Cliente;
}

const COMPROBANTES: [string, string][] = [['remito', 'Remito'], ['factura_b', 'Factura B'], ['factura_a', 'Factura A'], ['sin_comprobante', 'Sin comprobante']];
const pctNum = (t: string) => Number(t.replace(',', '.') || '0');
let contador = 0;

export default function NuevaVenta({ listas, medios, cajas, clienteInicial }: Props) {
  const router = useRouter();
  const [clave] = useState(() => crypto.randomUUID()); // la misma venta no se cierra dos veces
  const [cliente, setCliente] = useState<Cliente>(clienteInicial);
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [resultadosCliente, setResultadosCliente] = useState<Cliente[]>([]);
  const [comprobante, setComprobante] = useState('remito');
  const [nroComprobante, setNroComprobante] = useState('');
  const [listaId, setListaId] = useState(clienteInicial.listaId ?? listas[0]?.id ?? '');
  const [fecha, setFecha] = useState('');
  // Un solo descuento: por porcentaje o por el total final al que se quiere llegar.
  const [modoDesc, setModoDesc] = useState<'pct' | 'total'>('pct');
  const [descTotal, setDescTotal] = useState(String(clienteInicial.descuento || 0));
  const [totalFinal, setTotalFinal] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [busquedaProd, setBusquedaProd] = useState('');
  const [resultadosProd, setResultadosProd] = useState<Producto[]>([]);
  const [cobroTipo, setCobroTipo] = useState<'caja' | 'cuenta_corriente'>('caja');
  const [medioId, setMedioId] = useState('');
  const [cajaId, setCajaId] = useState('');
  const [nota, setNota] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const refs = useRef<Record<number, HTMLInputElement | null>>({});
  const buscarRef = useRef<HTMLInputElement | null>(null);
  // Enter en cantidad, precio o descuento vuelve al buscador para sumar otro producto.
  const enterABuscar = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); buscarRef.current?.focus(); } };

  const medio = medios.find((m) => m.id === medioId) ?? null;
  const cajasDelMedio = medio ? cajas.filter((c) => medio.cajaIds.includes(c.id)) : [];

  const calculo = useMemo(() => {
    try {
      const entrada = renglones.map((r) => {
        const cant = normalizarCantidad(r.cantidad || '0');
        const precio = normalizarImporte(r.precio || '0');
        if (cant === null || precio === null) throw new Error('dato inválido');
        return { cantidad: cant, precio: aCentavos(precio), descuentoPct: pctNum(r.descuentoPct), iva: r.iva };
      });
      const pideTotal = modoDesc === 'total' && totalFinal.trim() !== '';
      const tf = pideTotal ? normalizarImporte(totalFinal) : null;
      if (pideTotal && tf === null) throw new Error('total inválido');
      const v = calcularVenta(entrada, tf !== null ? { totalFinal: aCentavos(tf) } : modoDesc === 'pct' ? pctNum(descTotal) : 0);
      const comision = cobroTipo === 'caja' && medio ? comisionDeCobro(v.total, medio.comisionPct, medio.ivaComision) : 0;
      return { v, comision, ok: true as const };
    } catch {
      return { ok: false as const };
    }
  }, [renglones, modoDesc, descTotal, totalFinal, cobroTipo, medio]);
  const pctEquivalente = calculo.ok && calculo.v.subtotal > 0 ? Math.round((calculo.v.descuentoTotal / calculo.v.subtotal) * 10000) / 100 : 0;
  const alternarDescuento = () => {
    if (modoDesc === 'pct') { setTotalFinal(calculo.ok ? deCentavos(calculo.v.total) : ''); setModoDesc('total'); }
    else { setDescTotal(String(pctEquivalente || 0)); setModoDesc('pct'); }
  };

  const buscarCliente = async (q: string) => {
    setBusquedaCliente(q);
    setResultadosCliente(q.trim() ? await buscarClientesAccion(q) : []);
  };
  const elegirCliente = (c: Cliente) => {
    setCliente(c);
    setResultadosCliente([]);
    setBusquedaCliente('');
    if (c.listaId) setListaId(c.listaId);
    setDescTotal(String(c.descuento || 0));
    setModoDesc('pct');
    if (!c.cuentaCorriente && cobroTipo === 'cuenta_corriente') setCobroTipo('caja');
  };
  const buscarProducto = async (q: string) => {
    setBusquedaProd(q);
    setResultadosProd(q.trim() ? await buscarProductosAccion(q, listaId || null) : []);
  };
  const agregar = (p: Producto) => {
    const clave = ++contador;
    // El producto nuevo va arriba y el cursor pasa a la cantidad.
    setRenglones((r) => [{ clave, productoId: p.id, descripcion: p.nombre, cantidad: '1', precio: p.precio, descuentoPct: '0', iva: p.iva, stock: p.stock }, ...r]);
    setResultadosProd([]);
    setBusquedaProd('');
    setTimeout(() => refs.current[clave]?.select(), 0);
  };
  const agregarLibre = () => {
    const clave = ++contador;
    setRenglones((r) => [{ clave, productoId: null, descripcion: '', cantidad: '1', precio: '', descuentoPct: '0', iva: 21, stock: null }, ...r]);
  };
  const actualizarPrecios = async () => {
    const ids = renglones.map((r) => r.productoId).filter((x): x is string => x !== null);
    if (!ids.length) return;
    const actuales = await buscarProductosAccion('', listaId || null, ids);
    setRenglones((rs) => rs.map((r) => { const p = actuales.find((x) => x.id === r.productoId); return p ? { ...r, precio: p.precio } : r; }));
  };
  const cambiar = (clave: number, campoR: keyof Renglon, valor: string) => setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, [campoR]: valor } : r)));

  const cerrar = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await cerrarVentaAccion({
        clave, clienteId: cliente.id, comprobante, nroComprobante, listaId: listaId || null, fecha, descuentoTotalPct: modoDesc === 'pct' ? pctNum(descTotal) : 0, totalFinal: modoDesc === 'total' && totalFinal.trim() !== '' ? totalFinal : null, nota,
        renglones: renglones.map((x) => ({ productoId: x.productoId, descripcion: x.descripcion, cantidad: x.cantidad, precio: x.precio, descuentoPct: pctNum(x.descuentoPct), iva: x.iva })),
        cobro: cobroTipo === 'cuenta_corriente' ? { tipo: 'cuenta_corriente' } : { tipo: 'caja', medioPagoId: medioId, cajaId },
      });
      if (r.error) { setMsg(r.error); return; }
      router.push(`/ventas/${r.id}${r.avisosStock?.length ? `?avisos=${encodeURIComponent(r.avisosStock.join(', '))}` : ''}`);
    });

  const $ = (c: number) => formatearPesos(c);
  const celda = { padding: '4px 6px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const chico = { ...campo, marginTop: 0, padding: 6 };
  const saldoDeuda = aCentavos(cliente.saldo) > 0;

  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 260px', position: 'relative' }}>
            <label style={etiqueta}>Cliente: <b>{cliente.nombre}</b>
              <input style={campo} placeholder="Buscar otro cliente…" value={busquedaCliente} onChange={(e) => buscarCliente(e.target.value)} />
            </label>
            {resultadosCliente.length > 0 && (
              <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: '#fff', border: '1px solid #d3e6de', borderRadius: 8 }}>
                {resultadosCliente.map((c) => (<div key={c.id} style={{ padding: 8, cursor: 'pointer' }} onClick={() => elegirCliente(c)}>{c.nombre}</div>))}
              </div>
            )}
            {saldoDeuda && <div style={{ color: '#b4571a', fontSize: 13 }}>⚠ Este cliente tiene un saldo pendiente de {$(aCentavos(cliente.saldo))}</div>}
          </div>
          <label style={{ ...etiqueta, flex: '1 1 150px' }}>Comprobante
            <select style={campo} value={comprobante} onChange={(e) => setComprobante(e.target.value)}>{COMPROBANTES.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}</select>
          </label>
          {(comprobante === 'factura_a' || comprobante === 'factura_b') && (
            <label style={{ ...etiqueta, flex: '1 1 140px' }}>N° de factura<input style={campo} value={nroComprobante} onChange={(e) => setNroComprobante(e.target.value)} /></label>
          )}
          <label style={{ ...etiqueta, flex: '1 1 150px' }}>Lista de precios
            <select style={campo} value={listaId} onChange={(e) => setListaId(e.target.value)}>{listas.map((l) => (<option key={l.id} value={l.id}>{l.nombre}</option>))}</select>
          </label>
          <label style={{ ...etiqueta, flex: '1 1 180px' }}>Fecha y hora (opcional)<input style={campo} type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        </div>
      </div>

      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
          <input ref={buscarRef} style={{ ...campo, marginTop: 0, flex: '3 1 260px' }} placeholder="Buscar producto por nombre o código…" value={busquedaProd} onChange={(e) => buscarProducto(e.target.value)} />
          <button type="button" style={botonSecundario} onClick={agregarLibre}>+ Ítem libre</button>
          <button type="button" style={botonSecundario} onClick={actualizarPrecios}>Actualizar precios</button>
          {resultadosProd.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 5, top: 44, left: 0, right: 0, background: '#fff', border: '1px solid #d3e6de', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
              {resultadosProd.map((p) => (
                <div key={p.id} style={{ padding: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => agregar(p)}>
                  <span>{p.nombre}</span><span style={{ color: '#5c6d66' }}>{$(aCentavos(p.precio))} · stock {formatearCantidad(p.stock)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={celda}>Producto</th><th style={celda}>Cant.</th><th style={celda}>Precio</th><th style={celda}>Desc. %</th>{(comprobante === 'factura_a' || comprobante === 'factura_b') && <th style={celda}>IVA</th>}<th style={celda}>Total</th><th style={celda}></th></tr></thead>
            <tbody>
              {renglones.map((r, i) => {
                const negativo = r.stock !== null && Number(r.stock) - Number(r.cantidad.replace(',', '.') || 0) < 0;
                return (
                  <tr key={r.clave}>
                    <td style={celda}>
                      {r.productoId ? r.descripcion : <input style={chico} placeholder="Descripción" value={r.descripcion} onChange={(e) => cambiar(r.clave, 'descripcion', e.target.value)} />}
                      {negativo && <div style={{ color: '#b4571a', fontSize: 12 }}>⚠ Queda con stock negativo ({formatearCantidad(r.stock!)} en stock)</div>}
                    </td>
                    <td style={{ ...celda, width: 80 }}><input ref={(el) => { refs.current[r.clave] = el; }} style={chico} inputMode="decimal" value={r.cantidad} onKeyDown={enterABuscar} onChange={(e) => cambiar(r.clave, 'cantidad', e.target.value)} /></td>
                    <td style={{ ...celda, width: 110 }}><input style={chico} inputMode="decimal" value={r.precio} onKeyDown={enterABuscar} onChange={(e) => cambiar(r.clave, 'precio', e.target.value)} /></td>
                    <td style={{ ...celda, width: 70 }}><input style={chico} inputMode="decimal" value={r.descuentoPct} onKeyDown={enterABuscar} onChange={(e) => cambiar(r.clave, 'descuentoPct', e.target.value)} /></td>
                    {(comprobante === 'factura_a' || comprobante === 'factura_b') && (
                      <td style={{ ...celda, width: 70 }}>{r.productoId ? `${r.iva}%` : (
                        <select style={chico} value={r.iva} onChange={(e) => setRenglones((rs) => rs.map((x) => (x.clave === r.clave ? { ...x, iva: Number(e.target.value) } : x)))}>{[0, 10.5, 21, 27].map((a) => (<option key={a} value={a}>{a}%</option>))}</select>
                      )}</td>
                    )}
                    <td style={{ ...celda, whiteSpace: 'nowrap' }}>{calculo.ok ? $(calculo.v.renglones[i]!.subtotal) : '—'}</td>
                    <td style={celda}><button type="button" style={botonSecundario} onClick={() => setRenglones((rs) => rs.filter((x) => x.clave !== r.clave))}>✕</button></td>
                  </tr>
                );
              })}
              {renglones.length === 0 && (<tr><td style={celda} colSpan={7}>Buscá un producto para agregarlo.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ ...etiqueta, flex: '0 1 230px', marginBottom: 0 }}>Descuento total
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button type="button" style={{ ...botonSecundario, whiteSpace: 'nowrap' }} title="Cambiar entre porcentaje y total final" onClick={alternarDescuento}>{modoDesc === 'pct' ? '% descuento' : '$ total final'} ⇄</button>
              {modoDesc === 'pct'
                ? <input style={{ ...campo, marginTop: 0 }} inputMode="decimal" aria-label="Descuento en porcentaje" value={descTotal} onChange={(e) => setDescTotal(e.target.value)} />
                : <input style={{ ...campo, marginTop: 0 }} inputMode="decimal" aria-label="Total final" value={totalFinal} onChange={(e) => setTotalFinal(e.target.value)} />}
            </div>
          </div>
          <label style={{ ...etiqueta, flex: '3 1 260px', marginBottom: 0 }}>Nota<input style={campo} value={nota} onChange={(e) => setNota(e.target.value)} /></label>
        </div>
        <div style={{ textAlign: 'right', marginTop: 12 }}>
          {calculo.ok && calculo.v.descuentoTotal > 0 && <div>Subtotal {$(calculo.v.subtotal)} · Descuento: −{$(calculo.v.descuentoTotal)} ({String(pctEquivalente).replace('.', ',')} %)</div>}
          {!calculo.ok && modoDesc === 'total' && totalFinal.trim() !== '' && renglones.length > 0 && <div style={{ color: '#b4571a', fontSize: 13 }}>El total final no puede superar al subtotal.</div>}
          <div style={{ fontSize: 24 }}><b>Total {calculo.ok ? $(calculo.v.total) : '—'}</b></div>
          {calculo.ok && (comprobante === 'factura_a' || comprobante === 'factura_b') && <div style={{ color: '#5c6d66', fontSize: 13 }}>IVA incluido en el total: {$(calculo.v.ivaIncluido)}</div>}
          {calculo.ok && calculo.comision > 0 && <div style={{ color: '#5c6d66', fontSize: 13 }}>Comisión {$(calculo.comision)} · Neto a cobrar {$(calculo.v.total - calculo.comision)}</div>}
        </div>
      </div>

      <div style={tarjeta}>
        <b>Cobro</b>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
          {cliente.cuentaCorriente && (
            <label style={{ fontSize: 14 }}>
              <input type="checkbox" checked={cobroTipo === 'cuenta_corriente'} onChange={(e) => setCobroTipo(e.target.checked ? 'cuenta_corriente' : 'caja')} /> Dejar en cuenta corriente (se paga $0)
            </label>
          )}
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
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" style={{ ...boton, fontSize: 16, padding: '12px 20px' }} disabled={pend || renglones.length === 0 || !calculo.ok} onClick={cerrar}>{pend ? 'Cerrando…' : 'Cerrar venta'}</button>
        </div>
      </div>
    </>
  );
}
