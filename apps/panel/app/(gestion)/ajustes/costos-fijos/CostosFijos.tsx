'use client';
import { useState, useTransition } from 'react';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import type { CostosFijos as Datos } from '../../../../lib/costosFijos.ts';
import { botonSecundario, campo, error as estiloError, tarjeta } from '../../../../lib/estilos.ts';
import { agregarCostoAccion, buscarCostoAccion, cantidadCostoAccion, configAccion, quitarCostoAccion } from './acciones.ts';

const plata = (t: string) => formatearPesos(aCentavos(t));

export default function CostosFijos({ cf }: { cf: Datos }) {
  const [activo, setActivo] = useState(cf.activo);
  const [dias, setDias] = useState(String(cf.dias));
  const [base, setBase] = useState<string>(cf.base);
  const [q, setQ] = useState('');
  const [hallados, setHallados] = useState<{ id: string; nombre: string; costo: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const correr = (f: () => Promise<{ error?: string }>, despues?: () => void) =>
    iniciar(async () => {
      setMsg(null);
      const r = await f();
      if (r.error) setMsg(r.error); else despues?.();
    });
  const guardarConfig = (a: boolean, d: string, b: string) => correr(() => configAccion(a, Number(d) || 30, b));

  return (
    <div style={tarjeta}>
      {msg && <div style={estiloError}>{msg}</div>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={activo} onChange={(e) => { setActivo(e.target.checked); guardarConfig(e.target.checked, dias, base); }} /> Sumar costo fijo al costo de los elaborados
      </label>
      <b style={{ display: 'block', marginTop: 12 }}>Costos fijos mensuales</b>
      {cf.items.length === 0 && <p style={{ color: '#5c6d66' }}>Sin costos cargados. Agregá productos que representen cada costo (por ejemplo «Alquiler», «Luz»), con su costo mensual.</p>}
      {cf.items.map((i) => (
        <div key={i.productoId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderTop: '1px solid #eef5f1' }}>
          <span style={{ flex: 1 }}>{i.nombre}<br /><small style={{ color: '#5c6d66' }}>{plata(i.costo)} c/u · cantidad</small></span>
          <input style={{ ...campo, width: 80, marginTop: 0 }} inputMode="decimal" defaultValue={formatearCantidad(i.cantidad)} onBlur={(e) => { if (e.target.value !== formatearCantidad(i.cantidad)) correr(() => cantidadCostoAccion(i.productoId, e.target.value)); }} />
          <b style={{ width: 100, textAlign: 'right' }}>{plata(i.subtotal)}</b>
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => correr(() => quitarCostoAccion(i.productoId))}>×</button>
        </div>
      ))}
      <input style={campo} placeholder="Agregar costo fijo (buscar producto: alquiler, luz, personal…)" value={q} onChange={(e) => { setQ(e.target.value); iniciar(async () => setHallados(await buscarCostoAccion(e.target.value))); }} />
      {hallados.map((h) => (
        <button key={h.id} type="button" style={{ ...botonSecundario, display: 'block', width: '100%', textAlign: 'left', margin: '4px 0' }} onClick={() => correr(() => agregarCostoAccion(h.id), () => { setQ(''); setHallados([]); })}>{h.nombre} <small>· {plata(h.costo)}</small></button>
      ))}
      <div style={{ marginTop: 10, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}><span>Total mensual</span><span>{plata(cf.totalMensual)}</span></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <label style={{ fontSize: 12, color: '#5c6d66', flex: '1 1 180px' }}>Período de producción (días)
          <input style={campo} inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} onBlur={() => guardarConfig(activo, dias, base)} />
        </label>
        <label style={{ fontSize: 12, color: '#5c6d66', flex: '1 1 180px' }}>Repartir según
          <select style={campo} value={base} onChange={(e) => { setBase(e.target.value); guardarConfig(activo, dias, e.target.value); }}>
            <option value="unidades">Unidades producidas</option>
            <option value="costo_ingredientes">Costo de ingredientes</option>
          </select>
        </label>
      </div>
      <b style={{ display: 'block', marginTop: 14 }}>Producción de los últimos {cf.dias} días</b>
      {cf.produccion.length === 0 && <p style={{ color: '#5c6d66' }}>Todavía no hay elaboraciones registradas en este período.</p>}
      {cf.produccion.map((p) => (
        <div key={p.productoId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid #eef5f1' }}>
          <span>{p.nombre}<br /><small style={{ color: '#5c6d66' }}>{formatearCantidad(p.unidades)} u. · costo fijo {plata(p.costoFijoPorUnidad)} por unidad</small></span>
          <b>{plata(p.costoPorUnidad)}</b>
        </div>
      ))}
    </div>
  );
}
