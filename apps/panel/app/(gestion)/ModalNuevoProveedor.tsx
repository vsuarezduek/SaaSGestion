'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta } from '../../lib/estilos.ts';
import { crearProveedorAccion } from './personas.ts';

const CONDICIONES: [string, string][] = [
  ['', 'Sin dato'], ['responsable_inscripto', 'Responsable inscripto'], ['monotributo', 'Monotributo'], ['exento', 'Exento'], ['consumidor_final', 'Consumidor final'],
];

interface Props {
  /** Lo que se escribió en el buscador: se propone como nombre. */
  nombreInicial: string;
  /** Categorías de proveedor ya usadas (se puede escribir una nueva). */
  categorias: string[];
  onCreado: (r: { id: string; nombre: string }) => void;
  onCerrar: () => void;
}

/** Ventana emergente para dar de alta un proveedor sin salir de la pantalla (como «Nuevo proveedor» del prototipo). */
export default function ModalNuevoProveedor({ nombreInicial, categorias, onCreado, onCerrar }: Props) {
  const [d, setD] = useState({ nombre: nombreInicial.trim(), categoria: '', contacto: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: '' });
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
    const r = await crearProveedorAccion({ ...d, nombre: d.nombre.trim(), condicionIva: d.condicionIva || null });
    if (r.error || !r.id) { setMsg(r.error ?? 'No se pudo crear el proveedor'); return; }
    onCreado({ id: r.id, nombre: d.nombre.trim() });
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Nuevo proveedor" onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,40,32,.45)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px', overflowY: 'auto' }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); guardar(); }}
        style={{ background: '#fff', borderRadius: 12, padding: 18, width: '100%', maxWidth: 560, boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <b style={{ fontSize: 17 }}>Nuevo proveedor</b>
        {msg && <div style={{ ...estiloError, marginTop: 10 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          {texto('nombre', 'Nombre')}
          <label style={{ ...etiqueta, flex: '1 1 180px' }}>Categoría
            <input style={campo} list="cats-prov-modal" placeholder="Elegí o escribí una nueva" value={d.categoria} onChange={(e) => set('categoria', e.target.value)} />
            <datalist id="cats-prov-modal">{categorias.map((c) => (<option key={c} value={c} />))}</datalist>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{texto('contacto', 'Nombre de contacto')}{texto('telefono', 'Teléfono')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{texto('email', 'Mail')}{texto('domicilio', 'Domicilio')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{texto('localidad', 'Localidad')}{texto('cuit', 'CUIT')}</div>
        <label style={{ ...etiqueta, maxWidth: 270 }}>Condición de IVA
          <select style={campo} value={d.condicionIva} onChange={(e) => set('condicionIva', e.target.value)}>
            {CONDICIONES.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" style={botonSecundario} disabled={pend} onClick={onCerrar}>Cancelar</button>
          <button type="submit" style={boton} disabled={pend}>{pend ? 'Guardando…' : 'Crear proveedor'}</button>
        </div>
      </form>
    </div>
  );
}
