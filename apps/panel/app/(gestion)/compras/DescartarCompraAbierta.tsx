'use client';
import { useState, useTransition } from 'react';
import { botonSecundario } from '../../../lib/estilos.ts';
import { descartarCompraAbiertaAccion } from './acciones.ts';

export default function DescartarCompraAbierta({ id }: { id: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  return (
    <>
      <button type="button" style={botonSecundario} disabled={pend} onClick={() => {
        if (!window.confirm('¿Descartar esta compra abierta? No se puede recuperar.')) return;
        iniciar(async () => { const r = await descartarCompraAbiertaAccion(id); if (r.error) setMsg(r.error); });
      }}>Descartar</button>
      {msg && <span style={{ color: '#b4571a', fontSize: 12 }}>{msg}</span>}
    </>
  );
}
