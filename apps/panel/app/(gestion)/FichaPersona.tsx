'use client';
import { useState, useTransition, type ReactNode } from 'react';
import { botonSecundario, error as estiloError, tarjeta } from '../../lib/estilos.ts';
import FormularioPersona, { type Persona } from './FormularioPersona.tsx';
import { archivarPersonaAccion } from './personas.ts';

export interface GrupoDatos { titulo: string; filas: [string, string][] }

interface Props {
  tipo: 'cliente' | 'proveedor';
  persona: Persona;
  grupos: GrupoDatos[];
  categorias?: { id: string; nombre: string }[];
  categoriasProveedor?: string[];
  /** Botones de la ficha que son enlaces (+ Venta, + Nota de crédito, recibos…), armados en el servidor. */
  children?: ReactNode;
}

const gris = { fontSize: 12, color: '#5c6d66' } as const;
const igual = { ...botonSecundario, fontSize: 14, fontFamily: 'inherit' } as const;

/**
 * Cabecera de la ficha como el perfil del prototipo: el nombre, los datos en modo lectura
 * («Datos del cliente», «Condiciones comerciales», «Actividad») y los botones. «Editar» cambia
 * la vista por el formulario en el mismo lugar; Guardar o Cancelar vuelven a la vista.
 */
export default function FichaPersona({ tipo, persona, grupos, categorias, categoriasProveedor, children }: Props) {
  const [editando, setEditando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  if (editando) {
    return <FormularioPersona tipo={tipo} inicial={persona} categorias={categorias} categoriasProveedor={categoriasProveedor} onTerminar={() => setEditando(false)} />;
  }
  const archivar = () => {
    const accion = persona.activo ? 'archivar' : 'restaurar';
    if (!window.confirm(`¿${accion === 'archivar' ? 'Archivar' : 'Restaurar'} a «${persona.nombre}»? ${accion === 'archivar' ? 'Deja de aparecer en las búsquedas; su historial se conserva.' : ''}`)) return;
    iniciar(async () => {
      setMsg(null);
      const r = await archivarPersonaAccion(tipo, persona.id!, !persona.activo);
      if (r?.error) setMsg(r.error);
    });
  };
  return (
    <div style={tarjeta}>
      <h2 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: 22 }}>{persona.nombre}{!persona.activo && <span style={{ ...gris, marginLeft: 8 }}>(archivado)</span>}</h2>
      {msg && <div style={{ ...estiloError, marginTop: 8 }}>{msg}</div>}
      {grupos.map((g) => (
        <div key={g.titulo}>
          <div style={{ ...gris, marginTop: 12, fontWeight: 600 }}>{g.titulo}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '6px 14px', marginTop: 4, fontSize: 14 }}>
            {g.filas.map(([r, v]) => (<div key={r}><div style={gris}>{r}</div>{v || '–'}</div>))}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <button type="button" style={igual} disabled={pend} onClick={() => setEditando(true)}>Editar</button>
        {!persona.esConsumidorFinal && (
          <button type="button" style={igual} disabled={pend} onClick={archivar}>{persona.activo ? 'Archivar' : 'Restaurar'}</button>
        )}
        {children}
      </div>
    </div>
  );
}
