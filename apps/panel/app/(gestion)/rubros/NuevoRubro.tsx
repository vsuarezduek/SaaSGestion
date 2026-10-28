'use client';
import { useActionState } from 'react';
import { boton, campo, error as estiloError, tarjeta } from '../../../lib/estilos.ts';
import { crearRubroAccion } from './acciones.ts';

export default function NuevoRubro({ rubros }: { rubros: { id: string; ruta: string }[] }) {
  const [r, accion, pend] = useActionState(crearRubroAccion, null);
  return (
    <form action={accion} style={{ ...tarjeta, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {r?.error && <div style={{ ...estiloError, width: '100%' }}>{r.error}</div>}
      <input name="nombre" placeholder="Nombre del rubro" style={{ ...campo, flex: '2 1 200px', marginTop: 0 }} />
      <select name="padre" style={{ ...campo, flex: '2 1 200px', marginTop: 0 }}>
        <option value="">Rubro principal</option>
        {rubros.map((x) => (<option key={x.id} value={x.id}>Dentro de: {x.ruta}</option>))}
      </select>
      <button type="submit" style={boton} disabled={pend}>Agregar</button>
    </form>
  );
}
