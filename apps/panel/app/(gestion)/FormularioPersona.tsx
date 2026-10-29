'use client';
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
}

const CONDICIONES: [string, string][] = [
  ['consumidor_final', 'Consumidor final'], ['responsable_inscripto', 'Responsable inscripto'], ['monotributo', 'Monotributo'], ['exento', 'Exento'],
];

export default function FormularioPersona({ tipo, inicial, categorias = [], categoriasProveedor = [] }: Props) {
  const [d, setD] = useState(inicial);
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
      if (r?.error) setMsg(r.error);
    });
  const archivar = () =>
    iniciar(async () => {
      const r = await archivarPersonaAccion(tipo, d.id!, !d.activo);
      if (r?.error) setMsg(r.error);
    });

  return (
    <div style={{ ...tarjeta, maxWidth: 720 }}>
      {msg && <div style={estiloError}>{msg}</div>}
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
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" style={boton} disabled={pend} onClick={guardar}>{pend ? 'Guardando…' : 'Guardar'}</button>
        {d.id && !d.esConsumidorFinal && (
          <button type="button" style={botonSecundario} disabled={pend} onClick={archivar}>{d.activo ? 'Archivar' : 'Restaurar'}</button>
        )}
      </div>
    </div>
  );
}
