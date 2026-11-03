'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { estadoUsuarioAccion, guardarUsuarioAccion } from './acciones.ts';

export interface Inicial { id: string | null; nombre: string; email: string; rol: string; permisos: string[]; cajasVisibles: string[] | null; activo: boolean; tienePin: boolean; tieneContrasena: boolean }
const ROLES: [string, string][] = [['administrador', 'Administrador'], ['encargada', 'Encargada'], ['atencion', 'Atención al público'], ['cocina', 'Cocina'], ['marketing', 'Marketing']];
const PERMISOS: [string, string][] = [['ajustes', 'Ajustes'], ['informes', 'Informes y estadísticas'], ['descargar', 'Descargar (exportar)'], ['permisos', 'Cambiar permisos']];

export default function FormUsuario({ inicial, cajas, esYo, puedeAdministradores }: { inicial: Inicial; cajas: { id: string; nombre: string }[]; esYo: boolean; puedeAdministradores: boolean }) {
  const router = useRouter();
  const [d, setD] = useState({ nombre: inicial.nombre, email: inicial.email, rol: inicial.rol, permisos: inicial.permisos, todas: inicial.cajasVisibles === null, cajas: inicial.cajasVisibles ?? [], contrasena: '', pin: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pend, iniciar] = useTransition();
  const alternar = (lista: string[], x: string) => (lista.includes(x) ? lista.filter((y) => y !== x) : [...lista, x]);
  const guardar = () =>
    iniciar(async () => {
      setMsg(null); setOk(false);
      const r = await guardarUsuarioAccion(inicial.id, { nombre: d.nombre, email: d.email, rol: d.rol, permisos: d.permisos, cajasVisibles: d.todas ? null : d.cajas, contrasena: d.contrasena, pin: d.pin });
      if (r.error) { setMsg(r.error); return; }
      if (inicial.id === null) router.push(`/ajustes/usuarios/${r.id}`); else { setOk(true); setD({ ...d, contrasena: '', pin: '' }); router.refresh(); }
    });
  const cambiarEstado = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await estadoUsuarioAccion(inicial.id!, !inicial.activo);
      if (r.error) setMsg(r.error); else router.refresh();
    });
  return (
    <div style={tarjeta}>
      {msg && <div style={estiloError}>{msg}</div>}
      {ok && <div style={{ background: '#d9f1f2', color: '#1b5f63', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Guardado.</div>}
      <label style={etiqueta}>Nombre<input style={campo} value={d.nombre} maxLength={60} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></label>
      <label style={etiqueta}>Mail (para entrar con contraseña)<input style={campo} type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
      <label style={etiqueta}>Tipo de usuario
        <select style={campo} value={d.rol} disabled={esYo} onChange={(e) => setD({ ...d, rol: e.target.value })}>
          {ROLES.filter(([v]) => v !== 'administrador' || puedeAdministradores || inicial.rol === 'administrador').map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <div style={etiqueta}>Permisos adicionales {d.rol === 'administrador' && <i>(el administrador puede todo)</i>}
        {PERMISOS.map(([v, t]) => (
          <label key={v} style={{ display: 'block', fontSize: 14, color: '#1b2a24' }}>
            <input type="checkbox" disabled={esYo || d.rol === 'administrador'} checked={d.permisos.includes(v)} onChange={() => setD({ ...d, permisos: alternar(d.permisos, v) })} /> {t}
          </label>
        ))}
      </div>
      <div style={etiqueta}>Cajas que ve
        <label style={{ display: 'block', fontSize: 14, color: '#1b2a24' }}><input type="checkbox" checked={d.todas} onChange={(e) => setD({ ...d, todas: e.target.checked })} /> Todas</label>
        {!d.todas && cajas.map((k) => (
          <label key={k.id} style={{ display: 'block', fontSize: 14, color: '#1b2a24', marginLeft: 18 }}>
            <input type="checkbox" checked={d.cajas.includes(k.id)} onChange={() => setD({ ...d, cajas: alternar(d.cajas, k.id) })} /> {k.nombre}
          </label>
        ))}
      </div>
      <label style={etiqueta}>{inicial.tieneContrasena ? 'Contraseña nueva (vacío = no cambiar)' : d.rol === 'administrador' ? 'Contraseña (obligatoria)' : 'Contraseña (opcional)'}
        <input style={campo} type="password" autoComplete="new-password" value={d.contrasena} onChange={(e) => setD({ ...d, contrasena: e.target.value })} />
      </label>
      <label style={etiqueta}>{inicial.tienePin ? 'PIN nuevo (vacío = no cambiar)' : 'PIN de mostrador (4 a 8 números)'}
        <input style={campo} inputMode="numeric" autoComplete="off" value={d.pin} maxLength={8} onChange={(e) => setD({ ...d, pin: e.target.value.replace(/\D/g, '') })} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={boton} disabled={pend} onClick={guardar}>{inicial.id ? 'Guardar' : 'Crear usuario'}</button>
        {inicial.id && !esYo && <button type="button" style={botonSecundario} disabled={pend} onClick={cambiarEstado}>{inicial.activo ? 'Desactivar' : 'Reactivar'}</button>}
      </div>
    </div>
  );
}
