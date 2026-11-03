'use client';
import { useState, useTransition } from 'react';
import { boton, campo, error as estiloError, tarjeta } from '../../../lib/estilos.ts';
import { cambiarOperadorAccion } from './acciones.ts';

export default function SelectorOperador({ operadores, actualId }: { operadores: { id: string; nombre: string; rol: string }[]; actualId: string }) {
  const [elegido, setElegido] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const entrar = () => iniciar(async () => { setMsg(null); const r = await cambiarOperadorAccion(elegido!, pin); if (r?.error) { setMsg(r.error); setPin(''); } });
  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      {operadores.length === 0 && <p style={tarjeta}>Todavía no hay operadores con PIN. Creálos en Ajustes → Usuarios.</p>}
      {operadores.map((o) => (
        <div key={o.id} style={tarjeta}>
          <button type="button" onClick={() => { setElegido(o.id); setPin(''); setMsg(null); }} style={{ background: 'none', border: 0, font: '600 16px inherit', cursor: 'pointer', color: '#1c9764', padding: 0 }}>{o.nombre}{o.id === actualId ? ' (operando)' : ''}</button>
          {elegido === o.id && (
            <form onSubmit={(e) => { e.preventDefault(); entrar(); }} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input autoFocus style={{ ...campo, marginTop: 0 }} type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              <button style={boton} disabled={pend || pin.length < 4}>Entrar</button>
            </form>
          )}
        </div>
      ))}
    </>
  );
}
