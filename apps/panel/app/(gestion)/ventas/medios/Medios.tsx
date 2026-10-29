'use client';
import { useState, useTransition } from 'react';
import { boton, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { guardarMedioAccion } from '../acciones.ts';

interface Medio { id: string | null; nombre: string; comision: string; iva: number; cajaIds: string[] }

function Editor({ inicial, cajas }: { inicial: Medio; cajas: { id: string; nombre: string }[] }) {
  const [d, setD] = useState(inicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const guardar = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await guardarMedioAccion(d.id, { nombre: d.nombre, comisionPct: Number(d.comision.replace(',', '.') || '0'), ivaComision: d.iva, cajaIds: d.cajaIds });
      if (r.error) setMsg(r.error); else if (!d.id) setD(inicial);
    });
  return (
    <div style={{ ...tarjeta, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
      {msg && <div style={{ ...estiloError, width: '100%' }}>{msg}</div>}
      <label style={{ ...etiqueta, flex: '2 1 160px', marginBottom: 0 }}>Nombre<input style={campo} value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></label>
      <label style={{ ...etiqueta, flex: '0 1 100px', marginBottom: 0 }}>Comisión %<input style={campo} inputMode="decimal" value={d.comision} onChange={(e) => setD({ ...d, comision: e.target.value })} /></label>
      <label style={{ ...etiqueta, flex: '0 1 90px', marginBottom: 0 }}>IVA s/com.
        <select style={campo} value={d.iva} onChange={(e) => setD({ ...d, iva: Number(e.target.value) })}>{[0, 10.5, 21, 27].map((a) => (<option key={a} value={a}>{a}%</option>))}</select>
      </label>
      <div style={{ flex: '3 1 240px', fontSize: 13 }}>
        Cajas habilitadas:{' '}
        {cajas.map((c) => (
          <label key={c.id} style={{ marginRight: 10 }}>
            <input type="checkbox" checked={d.cajaIds.includes(c.id)} onChange={(e) => setD({ ...d, cajaIds: e.target.checked ? [...d.cajaIds, c.id] : d.cajaIds.filter((x) => x !== c.id) })} /> {c.nombre}
          </label>
        ))}
        {cajas.length === 0 && <i>Primero creá las cajas.</i>}
      </div>
      <button type="button" style={boton} disabled={pend} onClick={guardar}>{d.id ? 'Guardar' : 'Agregar'}</button>
    </div>
  );
}

export default function Medios({ medios, cajas }: { medios: Medio[]; cajas: { id: string; nombre: string }[] }) {
  return (
    <>
      <Editor key="nuevo" cajas={cajas} inicial={{ id: null, nombre: '', comision: '0', iva: 21, cajaIds: [] }} />
      {medios.map((m) => (<Editor key={m.id} cajas={cajas} inicial={m} />))}
    </>
  );
}
