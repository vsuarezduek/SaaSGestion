'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta } from '../../lib/estilos.ts';
import type { ClienteParaVenta } from '../../lib/ventas.ts';
import { crearClienteAccion } from './personas.ts';

const CONDICIONES: [string, string][] = [
  ['consumidor_final', 'Consumidor final'], ['responsable_inscripto', 'Responsable inscripto'], ['monotributo', 'Monotributo'], ['exento', 'Exento'],
];

interface Props {
  /** Lo que se escribió en el buscador: se propone como nombre. */
  nombreInicial: string;
  categorias: { id: string; nombre: string }[];
  onCreado: (r: { id: string; nombre: string; cliente: ClienteParaVenta | null }) => void;
  onCerrar: () => void;
}

/** Ventana emergente para dar de alta un cliente sin salir de la pantalla (como «Nuevo cliente» del prototipo). */
export default function ModalNuevoCliente({ nombreInicial, categorias, onCreado, onCerrar }: Props) {
  const [d, setD] = useState({ nombre: nombreInicial.trim(), categoriaId: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const primero = useRef<HTMLInputElement | null>(null);
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;
  useEffect(() => {
    primero.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') cerrarRef.current(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const texto = (k: keyof typeof d, rotulo: string) => (
    <label style={{ ...etiqueta, flex: '1 1 200px' }}>{rotulo}
      <input ref={k === 'nombre' ? primero : undefined} style={campo} value={d[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const guardar = () => iniciar(async () => {
    setMsg(null);
    if (!d.nombre.trim()) { setMsg('Falta el nombre'); return; }
    const r = await crearClienteAccion({ ...d, nombre: d.nombre.trim(), categoriaId: d.categoriaId || null });
    if (r.error || !r.id) { setMsg(r.error ?? 'No se pudo crear el cliente'); return; }
    onCreado({ id: r.id, nombre: d.nombre.trim(), cliente: r.cliente ?? null });
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Nuevo cliente" onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,40,32,.45)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px', overflowY: 'auto' }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); guardar(); }}
        style={{ background: '#fff', borderRadius: 12, padding: 18, width: '100%', maxWidth: 560, boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <b style={{ fontSize: 17 }}>Nuevo cliente</b>
        {msg && <div style={{ ...estiloError, marginTop: 10 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          {texto('nombre', 'Nombre')}
          <label style={{ ...etiqueta, flex: '1 1 180px' }}>Categoría
            <select style={campo} value={d.categoriaId} onChange={(e) => set('categoriaId', e.target.value)}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{texto('telefono', 'Teléfono')}{texto('email', 'Mail')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{texto('domicilio', 'Domicilio')}{texto('localidad', 'Localidad')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {texto('cuit', 'CUIT')}
          <label style={{ ...etiqueta, flex: '1 1 200px' }}>Condición de IVA
            <select style={campo} value={d.condicionIva} onChange={(e) => set('condicionIva', e.target.value)}>
              {CONDICIONES.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" style={botonSecundario} disabled={pend} onClick={onCerrar}>Cancelar</button>
          <button type="submit" style={boton} disabled={pend}>{pend ? 'Guardando…' : 'Crear cliente'}</button>
        </div>
      </form>
    </div>
  );
}
