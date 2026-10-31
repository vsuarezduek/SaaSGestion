'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, tarjeta } from '../../../../../lib/estilos.ts';
import { asignarValorAccion, buscarProductosAccion, quitarValorAccion, renombrarValorAccion } from '../acciones.ts';

interface Valor { valor: string; productos: { id: string; nombre: string; codigo: string | null }[] }

export default function ValoresExtra({ datoId, valores }: { datoId: string; valores: Valor[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [agregando, setAgregando] = useState<string | null>(null);   // valor al que se agregan productos ('' = valor nuevo)
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [q, setQ] = useState('');
  const [hallados, setHallados] = useState<{ id: string; nombre: string; codigo: string | null }[]>([]);
  const [elegidos, setElegidos] = useState<{ id: string; nombre: string }[]>([]);
  const [pend, iniciar] = useTransition();
  const correr = (f: () => Promise<{ error?: string }>, despues?: () => void) =>
    iniciar(async () => {
      setMsg(null);
      const r = await f();
      if (r.error) setMsg(r.error); else despues?.();
    });
  const cerrar = () => { setAgregando(null); setNombreNuevo(''); setQ(''); setHallados([]); setElegidos([]); };
  const buscar = (texto: string) => { setQ(texto); iniciar(async () => setHallados(await buscarProductosAccion(texto))); };

  return (
    <div>
      {msg && <div style={estiloError}>{msg}</div>}
      <button type="button" style={boton} onClick={() => { cerrar(); setAgregando(''); }}>+ Nuevo valor</button>
      {agregando !== null && (
        <div style={{ ...tarjeta, marginTop: 12 }}>
          {agregando === '' ? <input style={campo} placeholder="Valor (ej.: Feria de los sábados)" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} /> : <b>Agregar productos a «{agregando}»</b>}
          <input style={campo} placeholder="Buscar producto por nombre o código" value={q} onChange={(e) => buscar(e.target.value)} />
          {hallados.filter((h) => !elegidos.some((x) => x.id === h.id)).map((h) => (
            <div key={h.id}><button type="button" style={{ ...botonSecundario, margin: '4px 0' }} onClick={() => setElegidos([...elegidos, h])}>+ {h.nombre}{h.codigo ? ` (${h.codigo})` : ''}</button></div>
          ))}
          {elegidos.length > 0 && <p>Elegidos: {elegidos.map((x) => x.nombre).join(', ')}</p>}
          <button type="button" style={boton} disabled={pend || elegidos.length === 0 || (agregando === '' && !nombreNuevo.trim())}
            onClick={() => correr(() => asignarValorAccion(datoId, agregando === '' ? nombreNuevo : agregando, elegidos.map((x) => x.id)), cerrar)}>Guardar</button>{' '}
          <button type="button" style={botonSecundario} onClick={cerrar}>Cancelar</button>
        </div>
      )}
      {valores.length === 0 && <p style={{ color: '#5c6d66' }}>Ningún producto tiene valor todavía.</p>}
      {valores.map((v) => (
        <details key={v.valor} style={{ ...tarjeta, marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}><b>{v.valor}</b> · {v.productos.length} productos</summary>
          <div style={{ margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={botonSecundario} onClick={() => { cerrar(); setAgregando(v.valor); }}>+ Agregar productos</button>
            <button type="button" style={botonSecundario} disabled={pend} onClick={() => { const n = window.prompt('Nuevo nombre del valor', v.valor); if (n && n.trim() && n !== v.valor) correr(() => renombrarValorAccion(datoId, v.valor, n)); }}>Renombrar valor</button>
            <button type="button" style={botonSecundario} disabled={pend} onClick={() => { if (window.confirm(`¿Quitar «${v.valor}» a sus ${v.productos.length} productos?`)) correr(() => quitarValorAccion(datoId, v.valor)); }}>Quitar a todos</button>
          </div>
          {v.productos.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid #eef5f1' }}>
              <Link href={`/productos/${p.id}`}>{p.nombre}{p.codigo ? ` (${p.codigo})` : ''}</Link>
              <button type="button" style={botonSecundario} disabled={pend} onClick={() => correr(() => asignarValorAccion(datoId, '', [p.id]))}>Quitar</button>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
