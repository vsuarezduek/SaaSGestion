'use client';
import { useState, useTransition } from 'react';
import { boton, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { guardarCategoriaAccion } from '../../personas.ts';

export interface Cat { id: string | null; nombre: string; listaId: string; cuentaCorriente: boolean; descuento: string; ventaACosto: boolean }

function Editor({ inicial, listas }: { inicial: Cat; listas: { id: string; nombre: string }[] }) {
  const [d, setD] = useState(inicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const guardar = () =>
    iniciar(async () => {
      setMsg(null);
      const desc = Number(d.descuento.replace(',', '.') || '0');
      const r = await guardarCategoriaAccion(d.id, { nombre: d.nombre, listaId: d.listaId || null, cuentaCorriente: d.cuentaCorriente, descuento: desc, ventaACosto: d.ventaACosto });
      if (r.error) setMsg(r.error); else if (!d.id) setD(inicial);
    });
  return (
    <div style={{ ...tarjeta, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
      {msg && <div style={{ ...estiloError, width: '100%' }}>{msg}</div>}
      <label style={{ ...etiqueta, flex: '2 1 160px', marginBottom: 0 }}>Nombre<input style={campo} value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></label>
      <label style={{ ...etiqueta, flex: '1 1 140px', marginBottom: 0 }}>Lista de precios
        <select style={campo} value={d.listaId} onChange={(e) => setD({ ...d, listaId: e.target.value })}>
          <option value="">Sin lista</option>{listas.map((l) => (<option key={l.id} value={l.id}>{l.nombre}</option>))}
        </select>
      </label>
      <label style={{ ...etiqueta, flex: '0 1 90px', marginBottom: 0 }}>Desc. %<input style={campo} inputMode="decimal" value={d.descuento} onChange={(e) => setD({ ...d, descuento: e.target.value })} /></label>
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.cuentaCorriente} onChange={(e) => setD({ ...d, cuentaCorriente: e.target.checked })} /> Cuenta corriente</label>
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.ventaACosto} onChange={(e) => setD({ ...d, ventaACosto: e.target.checked })} /> Venta a costo</label>
      <button type="button" style={boton} disabled={pend} onClick={guardar}>{d.id ? 'Guardar' : 'Agregar'}</button>
    </div>
  );
}

export default function Categorias({ categorias, listas }: { categorias: Cat[]; listas: { id: string; nombre: string }[] }) {
  return (
    <>
      <Editor key="nueva" inicial={{ id: null, nombre: '', listaId: '', cuentaCorriente: false, descuento: '0', ventaACosto: false }} listas={listas} />
      {categorias.map((c) => (<Editor key={c.id} inicial={c} listas={listas} />))}
    </>
  );
}
