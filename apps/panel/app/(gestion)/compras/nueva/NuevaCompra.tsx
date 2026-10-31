'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { aCentavos, calcularCompra, formatearCantidad, formatearPesos, impuestoDeTransaccion, normalizarCantidad, normalizarImporte } from '../../../../../../packages/dominio/src/index.ts';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { agregarCategoriaAccion, buscarProductosCompraAccion, buscarProveedoresAccion, cerrarCompraAccion, faltantesAccion } from '../acciones.ts';

interface Proveedor { id: string; nombre: string; saldo: string }
interface Producto { id: string; nombre: string; codigo: string | null; unidad: string; costo: string; iva: number; stock: string }
interface Renglon { clave: number; productoId: string | null; descripcion: string; cantidad: string; costo: string; descuentoPct: string; iva: number; stock: string | null }
interface Props {
  categorias: string[];
  cajas: { id: string; nombre: string; impuesto: number }[];
  proveedorInicial: Proveedor | null;
  /** Compra cerrada que se está corrigiendo: al cerrar, esa se anula y la nueva la reemplaza. */
  edicion?: {
    compraId: string; numero: number;
    datos: { categoria: string; comprobante: string; nroComprobante: string; fecha: string; descTotal: string; modoCostos: string; pagoTipo: 'caja' | 'cuenta_corriente'; cajaId: string; nota: string;
      renglones: { productoId: string | null; descripcion: string; cantidad: string; costo: string; descuentoPct: string; iva: number }[] };
  } | null;
  /** Productos bajo el stock mínimo (cuando se llega desde "Comprar faltantes"). */
  faltantes?: (Producto & { cantidad: string })[];
  puedeAgregarCategorias: boolean;
}

const COMPROBANTES: [string, string][] = [['remito', 'Remito'], ['factura_a', 'Factura A'], ['factura_b', 'Factura B'], ['sin_comprobante', 'Sin comprobante']];
const MODOS: [string, string][] = [['costo_y_precio', 'Actualizar costo y mantener rentabilidad'], ['costo', 'Actualizar costo, no modificar precio'], ['ninguno', 'No actualizar costos']];
const pctNum = (t: string) => Number(t.replace(',', '.') || '0');
let contador = 0;

export default function NuevaCompra({ categorias, cajas, proveedorInicial, edicion, faltantes, puedeAgregarCategorias }: Props) {
  const ini = edicion?.datos;
  const router = useRouter();
  const [clave] = useState(() => crypto.randomUUID()); // la misma compra no se cierra dos veces
  const [proveedor, setProveedor] = useState<Proveedor | null>(proveedorInicial);
  const [busquedaProv, setBusquedaProv] = useState('');
  const [resultadosProv, setResultadosProv] = useState<Proveedor[]>([]);
  const [listaCategorias, setListaCategorias] = useState(categorias);
  const [categoria, setCategoria] = useState(ini?.categoria ?? categorias[0] ?? '');
  const [comprobante, setComprobante] = useState(ini?.comprobante ?? 'remito');
  const [nroComprobante, setNroComprobante] = useState(ini?.nroComprobante ?? '');
  const [fecha, setFecha] = useState(ini?.fecha ?? '');
  const [descTotal, setDescTotal] = useState(ini?.descTotal ?? '0');
  const [modoCostos, setModoCostos] = useState(ini?.modoCostos ?? 'costo_y_precio');
  const [renglones, setRenglones] = useState<Renglon[]>(() =>
    ini ? ini.renglones.map((r) => ({ clave: ++contador, ...r, stock: null }))
      : (faltantes ?? []).map((f) => ({ clave: ++contador, productoId: f.id, descripcion: f.nombre, cantidad: f.cantidad, costo: f.costo, descuentoPct: '0', iva: f.iva, stock: f.stock })));
  const [busquedaProd, setBusquedaProd] = useState('');
  const [resultadosProd, setResultadosProd] = useState<Producto[]>([]);
  const [pagoTipo, setPagoTipo] = useState<'caja' | 'cuenta_corriente'>(ini?.pagoTipo ?? 'caja');
  const [cajaId, setCajaId] = useState(ini?.cajaId || cajas[0]?.id || '');
  const [nota, setNota] = useState(ini?.nota ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const refs = useRef<Record<number, HTMLInputElement | null>>({});
  const buscarRef = useRef<HTMLInputElement | null>(null);
  const enterABuscar = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); buscarRef.current?.focus(); } };
  const esFactura = comprobante === 'factura_a' || comprobante === 'factura_b';
  const caja = cajas.find((c) => c.id === cajaId) ?? null;

  const calculo = useMemo(() => {
    try {
      const entrada = renglones.map((r) => {
        const cant = normalizarCantidad(r.cantidad || '0');
        const costo = normalizarImporte(r.costo || '0');
        if (cant === null || costo === null) throw new Error('dato inválido');
        return { cantidad: cant, costo: aCentavos(costo), descuentoPct: pctNum(r.descuentoPct), iva: r.iva };
      });
      const c = calcularCompra(entrada, pctNum(descTotal), esFactura);
      const impuesto = pagoTipo === 'caja' && caja ? impuestoDeTransaccion(c.total, caja.impuesto) : 0;
      return { c, impuesto, ok: true as const };
    } catch {
      return { ok: false as const };
    }
  }, [renglones, descTotal, esFactura, pagoTipo, caja]);

  const buscarProveedor = async (q: string) => {
    setBusquedaProv(q);
    setResultadosProv(q.trim() ? await buscarProveedoresAccion(q) : []);
  };
  const buscarProducto = async (q: string) => {
    setBusquedaProd(q);
    setResultadosProd(q.trim() ? await buscarProductosCompraAccion(q) : []);
  };
  const agregar = (p: Producto) => {
    const k = ++contador;
    setRenglones((r) => [{ clave: k, productoId: p.id, descripcion: p.nombre, cantidad: '1', costo: p.costo, descuentoPct: '0', iva: p.iva, stock: p.stock }, ...r]);
    setResultadosProd([]);
    setBusquedaProd('');
    setTimeout(() => refs.current[k]?.select(), 0);
  };
  const agregarLibre = () => {
    const k = ++contador;
    setRenglones((r) => [{ clave: k, productoId: null, descripcion: '', cantidad: '1', costo: '', descuentoPct: '0', iva: 21, stock: null }, ...r]);
  };
  const cargarFaltantes = async () => {
    const f = await faltantesAccion();
    if (f.length === 0) { setMsg('No hay productos por debajo del stock mínimo.'); return; }
    setMsg(null);
    setRenglones((rs) => {
      const ya = new Set(rs.map((r) => r.productoId));
      const nuevos = f.filter((x) => !ya.has(x.id)).map((x) => ({ clave: ++contador, productoId: x.id, descripcion: x.nombre, cantidad: x.cantidad, costo: x.costo, descuentoPct: '0', iva: x.iva, stock: x.stock }));
      return [...nuevos, ...rs];
    });
  };
  const actualizarCostos = async () => {
    const ids = renglones.map((r) => r.productoId).filter((x): x is string => x !== null);
    if (!ids.length) return;
    const actuales = await buscarProductosCompraAccion('', ids);
    setRenglones((rs) => rs.map((r) => { const p = actuales.find((x) => x.id === r.productoId); return p ? { ...r, costo: p.costo } : r; }));
  };
  const cambiar = (k: number, campoR: keyof Renglon, valor: string) => setRenglones((rs) => rs.map((r) => (r.clave === k ? { ...r, [campoR]: valor } : r)));
  const nuevaCategoria = async () => {
    const n = window.prompt('Nombre de la nueva categoría de compra');
    if (!n) return;
    const r = await agregarCategoriaAccion(n);
    if (r.error) { setMsg(r.error); return; }
    setListaCategorias((l) => (l.some((x) => x.toLowerCase() === n.trim().toLowerCase()) ? l : [...l, n.trim()]));
    setCategoria(n.trim());
  };

  const cerrar = () =>
    iniciar(async () => {
      setMsg(null);
      if (!proveedor) { setMsg('Elegí el proveedor'); return; }
      const r = await cerrarCompraAccion({
        clave, reemplazaCompraId: edicion?.compraId ?? null, proveedorId: proveedor.id, categoria, comprobante, nroComprobante, fecha, descuentoTotalPct: pctNum(descTotal), modoCostos, nota,
        renglones: renglones.map((x) => ({ productoId: x.productoId, descripcion: x.descripcion, cantidad: x.cantidad, costo: x.costo, descuentoPct: pctNum(x.descuentoPct), iva: x.iva })),
        pago: pagoTipo === 'cuenta_corriente' ? { tipo: 'cuenta_corriente' } : { tipo: 'caja', cajaId },
      });
      if (r.error) { setMsg(r.error); return; }
      router.push(`/compras/${r.id}`);
    });

  const $ = (c: number) => formatearPesos(c);
  const celda = { padding: '4px 6px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const chico = { ...campo, marginTop: 0, padding: 6 };
  const deuda = proveedor ? aCentavos(proveedor.saldo) : 0;

  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      {edicion && <div style={{ ...tarjeta, borderColor: '#f0c36b', background: '#fffaf0', fontSize: 14 }}>Estás corrigiendo la compra N° {edicion.numero}. Al guardar, esa compra se anula (queda registrada, con sus movimientos revertidos) y se crea una nueva con estos datos.</div>}
      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 260px', position: 'relative' }}>
            <label style={etiqueta}>Proveedor: <b>{proveedor?.nombre ?? 'sin elegir'}</b>
              <input style={campo} placeholder="Buscar proveedor…" value={busquedaProv} onChange={(e) => buscarProveedor(e.target.value)} />
            </label>
            {resultadosProv.length > 0 && (
              <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: '#fff', border: '1px solid #d3e6de', borderRadius: 8 }}>
                {resultadosProv.map((p) => (<div key={p.id} style={{ padding: 8, cursor: 'pointer' }} onClick={() => { setProveedor(p); setResultadosProv([]); setBusquedaProv(''); }}>{p.nombre}</div>))}
              </div>
            )}
            {proveedor && deuda > 0 && <div style={{ color: '#b4571a', fontSize: 13 }}>Le debemos a este proveedor {$(deuda)}</div>}
            {proveedor && deuda < 0 && <div style={{ color: '#1c9764', fontSize: 13 }}>Tenemos un saldo a favor de {$(-deuda)} con este proveedor</div>}
          </div>
          <label style={{ ...etiqueta, flex: '1 1 150px' }}>Comprobante
            <select style={campo} value={comprobante} onChange={(e) => setComprobante(e.target.value)}>{COMPROBANTES.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}</select>
          </label>
          {esFactura && <label style={{ ...etiqueta, flex: '1 1 140px' }}>N° de factura<input style={campo} placeholder="0001-00001234" value={nroComprobante} onChange={(e) => setNroComprobante(e.target.value)} /></label>}
          <label style={{ ...etiqueta, flex: '1 1 160px' }}>Categoría
            <select style={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)}>{listaCategorias.map((c) => (<option key={c} value={c}>{c}</option>))}</select>
            {puedeAgregarCategorias && <button type="button" style={{ ...botonSecundario, marginTop: 4, padding: '3px 8px', fontSize: 12 }} onClick={nuevaCategoria}>+ categoría</button>}
          </label>
          <label style={{ ...etiqueta, flex: '1 1 180px' }}>Fecha y hora (opcional)<input style={campo} type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        </div>
      </div>

      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
          <input ref={buscarRef} style={{ ...campo, marginTop: 0, flex: '3 1 260px' }} placeholder="Buscar producto por nombre o código…" value={busquedaProd} onChange={(e) => buscarProducto(e.target.value)} />
          <button type="button" style={botonSecundario} onClick={agregarLibre}>+ Ítem libre</button>
          <button type="button" style={botonSecundario} onClick={cargarFaltantes}>Cargar faltantes</button>
          <button type="button" style={botonSecundario} onClick={actualizarCostos}>Actualizar costos</button>
          {resultadosProd.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 5, top: 44, left: 0, right: 0, background: '#fff', border: '1px solid #d3e6de', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
              {resultadosProd.map((p) => (
                <div key={p.id} style={{ padding: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => agregar(p)}>
                  <span>{p.nombre}</span><span style={{ color: '#5c6d66' }}>{$(aCentavos(p.costo))} · stock {formatearCantidad(p.stock)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={celda}>Producto</th><th style={celda}>Cant.</th><th style={celda}>Costo (sin IVA)</th><th style={celda}>Desc. %</th>{esFactura && <th style={celda}>IVA</th>}<th style={celda}>Subtotal</th><th style={celda}></th></tr></thead>
            <tbody>
              {renglones.map((r, i) => (
                <tr key={r.clave}>
                  <td style={celda}>
                    {r.productoId ? r.descripcion : <input style={chico} placeholder="Descripción" value={r.descripcion} onChange={(e) => cambiar(r.clave, 'descripcion', e.target.value)} />}
                    {r.stock !== null && <div style={{ color: '#5c6d66', fontSize: 12 }}>Stock actual {formatearCantidad(r.stock)}</div>}
                  </td>
                  <td style={{ ...celda, width: 80 }}><input ref={(el) => { refs.current[r.clave] = el; }} style={chico} inputMode="decimal" value={r.cantidad} onKeyDown={enterABuscar} onChange={(e) => cambiar(r.clave, 'cantidad', e.target.value)} /></td>
                  <td style={{ ...celda, width: 120 }}><input style={chico} inputMode="decimal" value={r.costo} onKeyDown={enterABuscar} onChange={(e) => cambiar(r.clave, 'costo', e.target.value)} /></td>
                  <td style={{ ...celda, width: 70 }}><input style={chico} inputMode="decimal" value={r.descuentoPct} onKeyDown={enterABuscar} onChange={(e) => cambiar(r.clave, 'descuentoPct', e.target.value)} /></td>
                  {esFactura && (
                    <td style={{ ...celda, width: 70 }}>{r.productoId ? `${r.iva}%` : (
                      <select style={chico} value={r.iva} onChange={(e) => setRenglones((rs) => rs.map((x) => (x.clave === r.clave ? { ...x, iva: Number(e.target.value) } : x)))}>{[0, 10.5, 21, 27].map((a) => (<option key={a} value={a}>{a}%</option>))}</select>
                    )}</td>
                  )}
                  <td style={{ ...celda, whiteSpace: 'nowrap' }}>{calculo.ok ? $(calculo.c.renglones[i]!.subtotal) : '—'}</td>
                  <td style={celda}><button type="button" style={botonSecundario} onClick={() => setRenglones((rs) => rs.filter((x) => x.clave !== r.clave))}>✕</button></td>
                </tr>
              ))}
              {renglones.length === 0 && (<tr><td style={celda} colSpan={7}>Buscá un producto para agregarlo.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ ...etiqueta, flex: '0 1 160px', marginBottom: 0 }}>Descuento total %
            <input style={campo} inputMode="decimal" value={descTotal} onChange={(e) => setDescTotal(e.target.value)} />
          </label>
          <label style={{ ...etiqueta, flex: '2 1 260px', marginBottom: 0 }}>Costos y precios
            <select style={campo} value={modoCostos} onChange={(e) => setModoCostos(e.target.value)}>{MODOS.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}</select>
          </label>
          <label style={{ ...etiqueta, flex: '3 1 260px', marginBottom: 0 }}>Nota<input style={campo} value={nota} onChange={(e) => setNota(e.target.value)} /></label>
        </div>
        <div style={{ textAlign: 'right', marginTop: 12 }}>
          {calculo.ok && calculo.c.descuentoTotal > 0 && <div>Subtotal {$(calculo.c.subtotal)} · Descuento: −{$(calculo.c.descuentoTotal)}</div>}
          {calculo.ok && esFactura && <div style={{ color: '#5c6d66', fontSize: 13 }}>Neto gravado {$(calculo.c.neto)} · IVA {$(calculo.c.iva)}</div>}
          <div style={{ fontSize: 24 }}><b>Total {calculo.ok ? $(calculo.c.total) : '—'}</b></div>
          {calculo.ok && calculo.impuesto > 0 && <div style={{ color: '#5c6d66', fontSize: 13 }}>Impuesto por transacción de la caja ({caja!.impuesto}%) {$(calculo.impuesto)} · Sale de la caja en total {$(calculo.c.total + calculo.impuesto)}</div>}
        </div>
      </div>

      <div style={tarjeta}>
        <b>Pago</b>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
          <label style={{ fontSize: 14 }}>
            <input type="checkbox" checked={pagoTipo === 'cuenta_corriente'} onChange={(e) => setPagoTipo(e.target.checked ? 'cuenta_corriente' : 'caja')} /> Dejar en cuenta corriente (se paga $0)
          </label>
          {pagoTipo === 'caja' && (
            <label style={{ ...etiqueta, flex: '1 1 200px', marginBottom: 0 }}>Pagar desde
              <select style={campo} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                {cajas.length === 0 && <option value="">No hay cajas abiertas</option>}
                {cajas.map((c) => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
              </select>
            </label>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" style={{ ...boton, fontSize: 16, padding: '12px 20px' }} disabled={pend || renglones.length === 0 || !calculo.ok || !proveedor || (pagoTipo === 'caja' && !cajaId)} onClick={cerrar}>{pend ? 'Guardando…' : edicion ? 'Guardar cambios' : 'Cerrar compra'}</button>{' '}
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => router.push(edicion ? `/compras/${edicion.compraId}` : '/compras')}>{edicion ? 'Cancelar edición' : 'Cancelar'}</button>
        </div>
      </div>
    </>
  );
}
