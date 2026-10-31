'use client';
import { useEffect, useState, useTransition } from 'react';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import type { Receta } from '../../../../lib/recetas.ts';
import { aviso as estiloAviso, boton, botonSecundario, campo, error as estiloError, tarjeta } from '../../../../lib/estilos.ts';
import {
  agregarIngredienteAccion, anularElaboracionAccion, aplicarCostoAccion, buscarIngredientesAccion, cantidadIngredienteAccion, elaborarAccion,
  instruccionesAccion, previewElaboracionAccion, quitarIngredienteAccion, rindeAccion,
} from './acciones.ts';

const plata = (t: string) => formatearPesos(aCentavos(t));

export default function RecetaProducto({ r, nombre, unidad }: { r: Receta; nombre: string; unidad: string }) {
  const [tab, setTab] = useState<'ing' | 'ins'>('ing');
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hallados, setHallados] = useState<{ id: string; nombre: string; costo: string; stock: string }[]>([]);
  const [cantElab, setCantElab] = useState(formatearCantidad(r.rinde));
  const [claveElab, setClaveElab] = useState('');
  const [prev, setPrev] = useState<{ nombre: string; usa: string; stock: string; queda: string }[]>([]);
  const [instr, setInstr] = useState(r.instrucciones);
  const [pend, iniciar] = useTransition();

  useEffect(() => { setClaveElab(crypto.randomUUID()); }, []);
  useEffect(() => {
    if (!r.ingredientes.length) { setPrev([]); return; }
    const t = setTimeout(() => { previewElaboracionAccion(r.productoId, cantElab).then(setPrev); }, 250);
    return () => clearTimeout(t);
  }, [cantElab, r.productoId, r.ingredientes.length, r.rinde]);

  const correr = (f: () => Promise<{ error?: string; aviso?: string }>, despues?: () => void) =>
    iniciar(async () => {
      setMsg(null); setOk(null);
      const x = await f();
      if (x.error) setMsg(x.error); else { if (x.aviso) setOk(x.aviso); despues?.(); }
    });
  const buscar = (t: string) => { setQ(t); iniciar(async () => setHallados(await buscarIngredientesAccion(t, r.productoId))); };
  const difiere = r.ingredientes.length > 0 && Math.abs(aCentavos(r.costoReceta) - aCentavos(r.costoActual)) > 50;

  return (
    <div style={{ ...tarjeta, maxWidth: 720 }}>
      <b>Receta</b>
      <div style={{ margin: '8px 0', display: 'flex', gap: 8 }}>
        <button type="button" style={tab === 'ing' ? boton : botonSecundario} onClick={() => setTab('ing')}>Ingredientes</button>
        <button type="button" style={tab === 'ins' ? boton : botonSecundario} onClick={() => setTab('ins')}>Instrucciones</button>
      </div>
      {msg && <div style={estiloError}>{msg}</div>}
      {ok && <div style={estiloAviso}>{ok}</div>}
      {tab === 'ins' ? (
        <>
          <textarea rows={12} style={{ ...campo, fontFamily: 'inherit' }} value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Pasos de la elaboración…" />
          <button type="button" style={boton} disabled={pend} onClick={() => correr(() => instruccionesAccion(r.productoId, instr))}>Guardar instrucciones</button>
        </>
      ) : (
        <>
          <div style={{ color: '#5c6d66', fontSize: 13 }}>Cantidades para una tanda completa.</div>
          <label style={{ display: 'block', fontSize: 12, color: '#5c6d66', margin: '8px 0' }}>La tanda rinde (unidades de {nombre})
            <input style={{ ...campo, maxWidth: 160 }} inputMode="decimal" defaultValue={formatearCantidad(r.rinde)} onBlur={(e) => { if (e.target.value !== formatearCantidad(r.rinde)) correr(() => rindeAccion(r.productoId, e.target.value)); }} />
          </label>
          {r.ingredientes.length === 0 && <p style={{ color: '#5c6d66' }}>Sin ingredientes todavía.</p>}
          {r.ingredientes.map((i) => (
            <div key={i.id + i.cantidad} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderTop: '1px solid #eef5f1' }}>
              <span style={{ flex: 1 }}>{i.nombre}<br /><small style={{ color: '#5c6d66' }}>costo {plata(i.costo)} · stock {formatearCantidad(i.stock)} {i.unidad}</small></span>
              <input style={{ ...campo, width: 80, marginTop: 0 }} inputMode="decimal" defaultValue={formatearCantidad(i.cantidad)} onBlur={(e) => { if (e.target.value !== formatearCantidad(i.cantidad)) correr(() => cantidadIngredienteAccion(r.productoId, i.id, e.target.value)); }} />
              <b style={{ width: 90, textAlign: 'right' }}>{plata(i.subtotal)}</b>
              <button type="button" style={botonSecundario} disabled={pend} onClick={() => correr(() => quitarIngredienteAccion(r.productoId, i.id))}>×</button>
            </div>
          ))}
          <input style={campo} placeholder="Agregar ingrediente (buscar producto)" value={q} onChange={(e) => buscar(e.target.value)} />
          {hallados.map((h) => (
            <button key={h.id} type="button" style={{ ...botonSecundario, display: 'block', width: '100%', textAlign: 'left', margin: '4px 0' }} onClick={() => correr(() => agregarIngredienteAccion(r.productoId, h.id), () => { setQ(''); setHallados([]); })}>
              {h.nombre} <small>· costo {plata(h.costo)} · stock {formatearCantidad(h.stock)}</small>
            </button>
          ))}
          {r.ingredientes.length > 0 && (
            <>
              <div style={{ marginTop: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}><span>Costo por unidad según receta</span><span>{plata(r.costoReceta)}</span></div>
              <div style={{ color: '#5c6d66', fontSize: 13 }}>
                Ingredientes {plata(r.costoIngredientes)}{r.costoFijoActivo ? ` + costo fijo ${plata(r.costoFijo)}` : ' (costo fijo desactivado: Productos → Costos fijos)'}
              </div>
              <div style={{ color: '#5c6d66', fontSize: 13 }}>Costo actual cargado: {plata(r.costoActual)}{difiere ? ' · difiere de la receta' : ''}</div>
              <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
                <button type="button" style={boton} disabled={pend} onClick={() => correr(() => aplicarCostoAccion(r.productoId, true))}>Aplicar costo (mantener utilidad)</button>
                <button type="button" style={botonSecundario} disabled={pend} onClick={() => correr(() => aplicarCostoAccion(r.productoId, false))}>Aplicar solo el costo</button>
              </div>
              <hr style={{ border: 0, borderTop: '1px solid #d3e6de' }} />
              <b>Registrar elaboración</b>
              <label style={{ display: 'block', fontSize: 12, color: '#5c6d66', margin: '6px 0' }}>Cantidad que salió ({unidad})
                <input style={{ ...campo, maxWidth: 160 }} inputMode="decimal" value={cantElab} onChange={(e) => setCantElab(e.target.value)} />
              </label>
              {prev.map((p) => (
                <div key={p.nombre} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.nombre} <small style={{ color: Number(p.queda) < 0 ? '#b4571a' : '#5c6d66' }}>stock {formatearCantidad(p.stock)} → {formatearCantidad(p.queda)}</small></span><b>−{formatearCantidad(p.usa)}</b>
                </div>
              ))}
              <button type="button" style={{ ...boton, marginTop: 8 }} disabled={pend || !claveElab}
                onClick={() => correr(() => elaborarAccion(r.productoId, claveElab, cantElab, ''), () => setClaveElab(crypto.randomUUID()))}>Registrar elaboración</button>
            </>
          )}
          <b style={{ display: 'block', marginTop: 14 }}>Elaboraciones recientes</b>
          {r.elaboraciones.length === 0 && <p style={{ color: '#5c6d66' }}>Sin elaboraciones.</p>}
          {r.elaboraciones.map((e) => (
            <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderTop: '1px solid #eef5f1', opacity: e.estado === 'anulada' ? 0.5 : 1 }}>
              <span style={{ flex: 1, fontSize: 13 }}>N° {e.numero} · {new Date(e.fecha).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}{e.estado === 'anulada' ? ' (anulada)' : ''}<br />
                <small style={{ color: '#5c6d66' }}>usó {e.insumos.map((i) => `${i.nombre} ${formatearCantidad(i.cantidad)}`).join(', ')}</small></span>
              <b>+{formatearCantidad(e.cantidad)}</b>
              {e.estado !== 'anulada' && (
                <button type="button" style={botonSecundario} disabled={pend} onClick={() => { const m = window.prompt('Motivo de la anulación (se devuelve el stock de los ingredientes)'); if (m) correr(() => anularElaboracionAccion(r.productoId, e.id, m)); }}>Anular</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
