'use client';
import { useState, useTransition } from 'react';
import { boton, campo } from '../../lib/estilos.ts';
import { enviarPorMailAccion } from './acciones.ts';

interface Props { tipo: 'venta' | 'compra'; id: string; destino: string; cuenta: string }

/** Envía el comprobante desde la casilla conectada del comercio. */
export default function EnviarPorMail({ tipo, id, destino, cuenta }: Props) {
  const [para, setPara] = useState(destino);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pend, iniciar] = useTransition();
  const enviar = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await enviarPorMailAccion({ tipo, id, para });
      setMsg(r.error ? { ok: false, texto: r.error } : { ok: true, texto: `Enviado a ${r.enviado} desde ${cuenta}` });
    });
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input style={{ ...campo, width: 240, margin: 0 }} type="email" placeholder="mail del destinatario" value={para} onChange={(e) => setPara(e.target.value)} />
      <button type="button" style={boton} disabled={pend || para.trim() === ''} onClick={enviar}>{pend ? 'Enviando…' : 'Enviar por mail'}</button>
      {msg && <span style={{ fontSize: 13, color: msg.ok ? '#1c9764' : '#b4571a' }}>{msg.texto}</span>}
    </span>
  );
}
