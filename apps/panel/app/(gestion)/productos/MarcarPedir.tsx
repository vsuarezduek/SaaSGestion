'use client';
import { useState, useTransition } from 'react';
import { botonSecundario, error as estiloError } from '../../../lib/estilos.ts';
import { marcarParaPedirAccion } from './acciones.ts';

/** Marca el producto para que salga en la mercadería a pedir del Inicio aunque no esté bajo el mínimo. */
export default function MarcarPedir({ productoId, marcado }: { productoId: string; marcado: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  return (
    <div style={{ margin: '8px 0' }}>
      {msg && <div style={estiloError}>{msg}</div>}
      <button type="button" style={botonSecundario} disabled={pend} onClick={() => iniciar(async () => { setMsg(null); const r = await marcarParaPedirAccion(productoId, !marcado); if (r.error) setMsg(r.error); })}>
        {marcado ? '✓ Marcado para pedir (quitar)' : 'Marcar para pedir'}
      </button>
    </div>
  );
}
