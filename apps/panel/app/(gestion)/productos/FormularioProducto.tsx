'use client';
import { useState, useTransition } from 'react';
import { aCentavos, ALICUOTAS_IVA, deCentavos, normalizarImporte, precioDesdeUtilidad, utilidadDesdePrecio } from '../../../../../packages/dominio/src/index.ts';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../lib/estilos.ts';
import { archivarProductoAccion, guardarProductoAccion } from './acciones.ts';

export interface Inicial {
  id: string | null;
  codigo: string; nombre: string; rubroId: string; tipo: string; unidad: string; costo: string; iva: number;
  vendible: boolean; comprable: boolean; integrable: boolean; publicadoWeb: boolean; urlWeb: string;
  activo: boolean; precios: Record<string, string>; stockMinimo: string; stockIdeal: string;
}
interface Props {
  inicial: Inicial;
  listas: { id: string; nombre: string }[];
  rubros: { id: string; ruta: string }[];
}

export default function FormularioProducto({ inicial, listas, rubros }: Props) {
  const [d, setD] = useState(inicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const set = <K extends keyof Inicial>(k: K, v: Inicial[K]) => setD((x) => ({ ...x, [k]: v }));

  const costoN = normalizarImporte(d.costo || '0');
  const utilidad = (lista: string): string => {
    const p = normalizarImporte(d.precios[lista] ?? '');
    if (costoN === null || p === null || p === '0') return '';
    const u = utilidadDesdePrecio(aCentavos(costoN), aCentavos(p), d.iva);
    return u === null ? '' : String(u);
  };
  const ponerUtilidad = (lista: string, texto: string) => {
    const u = Number(texto.replace(',', '.'));
    if (costoN === null || !Number.isFinite(u)) return;
    set('precios', { ...d.precios, [lista]: deCentavos(precioDesdeUtilidad(aCentavos(costoN), u, d.iva)) });
  };

  const guardar = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await guardarProductoAccion(d.id, {
        codigo: d.codigo, nombre: d.nombre, rubroId: d.rubroId || null, tipo: d.tipo, unidad: d.unidad, costo: d.costo, iva: d.iva,
        stockMinimo: d.stockMinimo, stockIdeal: d.stockIdeal, vendible: d.vendible, comprable: d.comprable, integrable: d.integrable, publicadoWeb: d.publicadoWeb, urlWeb: d.urlWeb,
        precios: Object.fromEntries(Object.entries(d.precios).filter(([, v]) => v.trim() !== '')),
      });
      if (r?.error) setMsg(r.error);
    });

  const casilla = (k: 'vendible' | 'comprable' | 'integrable' | 'publicadoWeb', texto: string) => (
    <label style={{ marginRight: 14, fontSize: 14 }}>
      <input type="checkbox" checked={d[k]} onChange={(e) => set(k, e.target.checked)} /> {texto}
    </label>
  );

  return (
    <div style={{ ...tarjeta, maxWidth: 720 }}>
      {msg && <div style={estiloError}>{msg}</div>}
      <label style={etiqueta}>Nombre<input style={campo} value={d.nombre} onChange={(e) => set('nombre', e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...etiqueta, flex: '1 1 120px' }}>Código<input style={campo} value={d.codigo} onChange={(e) => set('codigo', e.target.value)} /></label>
        <label style={{ ...etiqueta, flex: '2 1 200px' }}>Rubro
          <select style={campo} value={d.rubroId} onChange={(e) => set('rubroId', e.target.value)}>
            <option value="">Sin rubro</option>
            {rubros.map((r) => (<option key={r.id} value={r.id}>{r.ruta}</option>))}
          </select>
        </label>
        <label style={{ ...etiqueta, flex: '1 1 120px' }}>Tipo<input style={campo} value={d.tipo} onChange={(e) => set('tipo', e.target.value)} /></label>
        <label style={{ ...etiqueta, flex: '1 1 90px' }}>Unidad<input style={campo} value={d.unidad} onChange={(e) => set('unidad', e.target.value)} /></label>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...etiqueta, flex: '1 1 140px' }}>Costo (sin IVA)<input style={campo} inputMode="decimal" value={d.costo} onChange={(e) => set('costo', e.target.value)} /></label>
        <label style={{ ...etiqueta, flex: '1 1 100px' }}>IVA %
          <select style={campo} value={d.iva} onChange={(e) => set('iva', Number(e.target.value))}>
            {ALICUOTAS_IVA.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...etiqueta, flex: '1 1 140px' }}>Stock mínimo (avisa si baja de acá)<input style={campo} inputMode="decimal" value={d.stockMinimo} onChange={(e) => set('stockMinimo', e.target.value)} /></label>
        <label style={{ ...etiqueta, flex: '1 1 140px' }}>Stock ideal (para armar compras)<input style={campo} inputMode="decimal" value={d.stockIdeal} onChange={(e) => set('stockIdeal', e.target.value)} /></label>
      </div>
      <b style={{ fontSize: 14 }}>Precios de venta (con IVA incluido)</b>
      {listas.map((l) => (
        <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ ...etiqueta, flex: '1 1 140px' }}>{l.nombre}
            <input style={campo} inputMode="decimal" value={d.precios[l.id] ?? ''} onChange={(e) => set('precios', { ...d.precios, [l.id]: e.target.value })} />
          </label>
          <label style={{ ...etiqueta, flex: '0 1 110px' }}>Utilidad %
            <input style={campo} inputMode="decimal" value={utilidad(l.id)} onChange={(e) => ponerUtilidad(l.id, e.target.value)} />
          </label>
        </div>
      ))}
      <div style={{ margin: '10px 0' }}>
        {casilla('vendible', 'Se vende')}{casilla('comprable', 'Se compra')}{casilla('integrable', 'Integra otros productos')}{casilla('publicadoWeb', 'Publicado en la tienda')}
      </div>
      <label style={etiqueta}>Enlace en la tienda online (opcional)<input style={campo} value={d.urlWeb} onChange={(e) => set('urlWeb', e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" style={boton} disabled={pend} onClick={guardar}>{pend ? 'Guardando…' : 'Guardar'}</button>
        {d.id && (
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => iniciar(() => archivarProductoAccion(d.id!, !d.activo))}>
            {d.activo ? 'Archivar' : 'Restaurar'}
          </button>
        )}
      </div>
    </div>
  );
}
