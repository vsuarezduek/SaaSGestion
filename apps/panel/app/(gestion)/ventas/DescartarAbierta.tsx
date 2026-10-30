'use client';
import { useState, useTransition } from 'react';
import { botonSecundario } from '../../../lib/estilos.ts';
import { descartarAbiertaAccion } from './acciones.ts';

export default function DescartarAbierta({ id, pedido = false }: { id: string; pedido?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  return (
    <>
      <button type="button" style={botonSecundario} disabled={pend} onClick={() => {
        if (!window.confirm(pedido ? '¿Cancelar este pedido? No se puede recuperar.' : '¿Descartar esta venta abierta? No se puede recuperar.')) return;
        iniciar(async () => { const r = await descartarAbiertaAccion(id); if (r.error) setMsg(r.error); });
      }}>{pedido ? 'Cancelar pedido' : 'Descartar'}</button>
      {msg && <span style={{ color: '#b4571a', fontSize: 12 }}>{msg}</span>}
    </>
  );
}
