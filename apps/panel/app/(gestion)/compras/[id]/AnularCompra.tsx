'use client';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { anularCompraAccion } from '../acciones.ts';

/** Anular pide un motivo y confirmación: la compra no se borra, se registra el movimiento inverso. */
export default function AnularCompra({ id, numero }: { id: string; numero: number }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  if (!abierto) return <button type="button" style={botonSecundario} onClick={() => setAbierto(true)}>Anular compra</button>;
  return (
    <div style={tarjeta}>
      <b>Anular la compra N° {numero}</b>
      <p style={{ fontSize: 13, color: '#5c6d66' }}>Se saca la mercadería del stock, se devuelve el pago a la caja (o se saca la deuda de la cuenta del proveedor) y la compra queda marcada como anulada. No se borra nada: queda el registro. Los costos y precios que actualizó la compra no se restauran: si hace falta, corregilos desde el producto.</p>
      {msg && <div style={estiloError}>{msg}</div>}
      <label style={etiqueta}>Motivo
        <input style={campo} value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: error de carga" />
      </label>
      <button type="button" style={boton} disabled={pend} onClick={() => iniciar(async () => {
        setMsg(null);
        const r = await anularCompraAccion(id, motivo);
        if (r.error) setMsg(r.error);
        else setAbierto(false);
      })}>{pend ? 'Anulando…' : 'Confirmar anulación'}</button>{' '}
      <button type="button" style={botonSecundario} disabled={pend} onClick={() => setAbierto(false)}>Cancelar</button>
    </div>
  );
}
