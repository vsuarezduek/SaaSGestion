'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../lib/estilos.ts';
import { archivarPersonaAccion, guardarPersonaAccion } from './personas.ts';

export interface Persona {
  id: string | null; nombre: string; telefono: string; email: string; domicilio: string; localidad: string; cuit: string;
  condicionIva: string; categoriaId: string; contacto: string; categoria: string; activo: boolean; esConsumidorFinal: boolean;
}
interface Props {
  tipo: 'cliente' | 'proveedor';
  inicial: Persona;
  categorias?: { id: string; nombre: string }[];   // clientes
  categoriasProveedor?: string[];                  // proveedores (lista con opción de nueva)
  /** Desde la ficha (vista de lectura): se abre ya editando, con Cancelar, y al terminar vuelve a la vista. */
  onTerminar?: () => void;
}

const CONDICIONES: [string, string][] = [
  ['consumidor_final', 'Consumidor final'], ['responsable_inscripto', 'Responsable inscripto'], ['monotributo', 'Monotributo'], ['exento', 'Exento'],
];

export default function FormularioPersona({ tipo, inicial, categorias = [], categoriasProveedor = [], onTerminar }: Props) {
  const router = useRouter();
  const [d, setD] = useState(inicial);
  // Una ficha existente se ve primero tal cual está; la casilla «Modificar» habilita los campos y al destildarla se vuelve a lo último guardado.
  const esNueva = inicial.id === null;
  const [editando, setEditando] = useState(esNueva || !!onTerminar);
  const [base, setBase] = useState(inicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => setD((x) => ({ ...x, [k]: v }));
  const texto = (k: keyof Persona, rotulo: string, extra?: { flex?: string }) => (
    <label style={{ ...etiqueta, flex: extra?.flex ?? '1 1 200px' }}>{rotulo}
      <input style={campo} value={String(d[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );

  const guardar = () =>
    iniciar(async () => {
      setMsg(null);
      const comunes = { nombre: d.nombre, telefono: d.telefono, email: d.email, domicilio: d.domicilio, localidad: d.localidad, cuit: d.cuit };
      const datos = tipo === 'cliente'
        ? { ...comunes, categoriaId: d.categoriaId || null, condicionIva: d.condicionIva || 'consumidor_final' }
        : { ...comunes, contacto: d.contacto, categoria: d.categoria, condicionIva: d.condicionIva || null };
      const r = await guardarPersonaAccion(tipo, d.id, datos);
      if (r?.error) { setMsg(r.error); return; }
      setBase(d);
      if (onTerminar) { router.refresh(); onTerminar(); return; }
      if (!esNueva) setEditando(false);
    });
  const archivar = () =>
    iniciar(async () => {
      const r = await archivarPersonaAccion(tipo, d.id!, !d.activo);
      if (r?.error) setMsg(r.error);
    });

  const alternarEdicion = (activar: boolean) => {
    if (!activar) { setD(base); setMsg(null); }
    setEditando(activar);
  };

  return (
    <div style={{ ...tarjeta, maxWidth: 720 }}>
      {msg && <div style={estiloError}>{msg}</div>}
      {!esNueva && !onTerminar && (
        <label style={{ display: 'inline-block', marginBottom: 10, fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={editando} disabled={pend} onChange={(e) => alternarEdicion(e.target.checked)} /> Modificar
        </label>
      )}
      <fieldset disabled={!editando} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {texto('nombre', 'Nombre', { flex: '2 1 260px' })}
        {tipo === 'cliente' ? (
          <label style={{ ...etiqueta, flex: '1 1 180px' }}>Categoría
            <select style={campo} value={d.categoriaId} onChange={(e) => set('categoriaId', e.target.value)}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
            </select>
          </label>
        ) : (
          <label style={{ ...etiqueta, flex: '1 1 180px' }}>Categoría
            <input style={campo} list="cats-prov" value={d.categoria} onChange={(e) => set('categoria', e.target.value)} />
            <datalist id="cats-prov">{categoriasProveedor.map((c) => (<option key={c} value={c} />))}</datalist>
          </label>
        )}
      </div>
      {tipo === 'proveedor' && texto('contacto', 'Contacto')}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {texto('telefono', 'Teléfono')}
        {texto('email', 'Mail')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {texto('domicilio', 'Domicilio', { flex: '2 1 260px' })}
        {texto('localidad', 'Localidad')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {texto('cuit', 'CUIT')}
        <label style={{ ...etiqueta, flex: '1 1 200px' }}>Condición de IVA
          <select style={campo} value={d.condicionIva} onChange={(e) => set('condicionIva', e.target.value)}>
            {tipo === 'proveedor' && <option value="">Sin dato</option>}
            {CONDICIONES.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}
          </select>
        </label>
      </div>
      </fieldset>
      {editando && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" style={boton} disabled={pend} onClick={guardar}>{pend ? 'Guardando…' : 'Guardar'}</button>
          {onTerminar && <button type="button" style={botonSecundario} disabled={pend} onClick={onTerminar}>Cancelar</button>}
          {!onTerminar && d.id && !d.esConsumidorFinal && (
            <button type="button" style={botonSecundario} disabled={pend} onClick={archivar}>{d.activo ? 'Archivar' : 'Restaurar'}</button>
          )}
        </div>
      )}
    </div>
  );
}
