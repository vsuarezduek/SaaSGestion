'use client';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { anularReciboAccion } from '../acciones.ts';

/** Anular pide un motivo y confirmación: el recibo no se borra, se registran los movimientos inversos. */
export default function AnularRecibo({ id, numero }: { id: string; numero: number }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  if (!abierto) return <button type="button" style={botonSecundario} onClick={() => setAbierto(true)}>Anular recibo</button>;
  return (
    <div style={tarjeta}>
      <b>Anular el recibo N° {numero}</b>
      <p style={{ fontSize: 13, color: '#5c6d66' }}>Se saca el ingreso de la caja y la deuda vuelve al saldo del cliente. No se borra nada: queda el registro.</p>
      {msg && <div style={estiloError}>{msg}</div>}
      <label style={etiqueta}>Motivo
        <input style={campo} value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: importe mal cargado" />
      </label>
      <button type="button" style={boton} disabled={pend} onClick={() => iniciar(async () => {
        setMsg(null);
        const r = await anularReciboAccion(id, motivo);
        if (r.error) setMsg(r.error); else setAbierto(false);
      })}>{pend ? 'Anulando…' : 'Confirmar anulación'}</button>{' '}
      <button type="button" style={botonSecundario} disabled={pend} onClick={() => setAbierto(false)}>Cancelar</button>
    </div>
  );
}
