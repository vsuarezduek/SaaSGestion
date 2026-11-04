'use client';
import { useState, useTransition } from 'react';
import { botonSecundario, error as estiloError } from '../../../../lib/estilos.ts';
import { desconectarCorreoAccion } from './acciones.ts';

export default function Desconectar() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      <button type="button" style={botonSecundario} disabled={pend}
        onClick={() => { if (window.confirm('¿Desconectar la casilla? Dejás de poder enviar comprobantes por mail hasta volver a conectarla.')) iniciar(async () => { const r = await desconectarCorreoAccion(); if (r.error) setMsg(r.error); }); }}>
        {pend ? 'Desconectando…' : 'Desconectar'}
      </button>
    </>
  );
}
