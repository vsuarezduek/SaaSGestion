'use client';
import { useState, useTransition } from 'react';
import { boton, campo, error as estiloError, etiqueta, tarjeta } from '../../../lib/estilos.ts';
import { cambiarContrasenaAccion, cambiarPinAccion } from './acciones.ts';

export default function FormCuenta({ tieneContrasena, tienePin, esAdmin }: { tieneContrasena: boolean; tienePin: boolean; esAdmin: boolean }) {
  const [c, setC] = useState({ actual: '', nueva: '' });
  const [p, setP] = useState({ actual: '', nuevo: '' });
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pend, iniciar] = useTransition();
  const aviso = (r: { error?: string }, ok: string) => setMsg(r.error ? { ok: false, texto: r.error } : { ok: true, texto: ok });
  return (
    <>
      {msg && <div style={msg.ok ? { background: '#d9f1f2', color: '#1b5f63', borderRadius: 8, padding: '8px 12px', marginBottom: 12 } : estiloError}>{msg.texto}</div>}
      {tieneContrasena && (
        <div style={tarjeta}>
          <b>Cambiar contraseña</b>
          <label style={etiqueta}>Contraseña actual<input style={campo} type="password" autoComplete="current-password" value={c.actual} onChange={(e) => setC({ ...c, actual: e.target.value })} /></label>
          <label style={etiqueta}>Contraseña nueva (mínimo 8 caracteres)<input style={campo} type="password" autoComplete="new-password" value={c.nueva} onChange={(e) => setC({ ...c, nueva: e.target.value })} /></label>
          <button type="button" style={boton} disabled={pend} onClick={() => iniciar(async () => { aviso(await cambiarContrasenaAccion(c.actual, c.nueva), 'Contraseña cambiada.'); setC({ actual: '', nueva: '' }); })}>Cambiar contraseña</button>
        </div>
      )}
      <div style={tarjeta}>
        <b>{tienePin ? 'Cambiar PIN de mostrador' : 'Crear PIN de mostrador'}</b>
        {(tienePin || esAdmin) && <label style={etiqueta}>{esAdmin ? 'Tu contraseña' : 'PIN actual'}<input style={campo} type="password" inputMode={esAdmin ? undefined : 'numeric'} value={p.actual} onChange={(e) => setP({ ...p, actual: e.target.value })} /></label>}
        <label style={etiqueta}>PIN nuevo (4 a 8 números)<input style={campo} inputMode="numeric" maxLength={8} value={p.nuevo} onChange={(e) => setP({ ...p, nuevo: e.target.value.replace(/\D/g, '') })} /></label>
        <button type="button" style={boton} disabled={pend} onClick={() => iniciar(async () => { aviso(await cambiarPinAccion(p.actual, p.nuevo), 'PIN guardado.'); setP({ actual: '', nuevo: '' }); })}>Guardar PIN</button>
      </div>
    </>
  );
}
