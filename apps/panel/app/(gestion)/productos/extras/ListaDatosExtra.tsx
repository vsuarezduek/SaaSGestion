'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, tarjeta } from '../../../../lib/estilos.ts';
import { crearDatoAccion, quitarDatoAccion, renombrarDatoAccion } from './acciones.ts';

export default function ListaDatosExtra({ datos }: { datos: { id: string; nombre: string; productos: number; valores: number }[] }) {
  const [nuevo, setNuevo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const correr = (f: () => Promise<{ error?: string }>, despues?: () => void) =>
    iniciar(async () => {
      setMsg(null);
      const r = await f();
      if (r.error) setMsg(r.error); else despues?.();
    });
  return (
    <div>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={{ ...tarjeta, display: 'flex', gap: 8 }}>
        <input style={{ ...campo, marginTop: 0 }} placeholder="Nuevo dato extra (ej.: Ferias)" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button type="button" style={boton} disabled={pend || !nuevo.trim()} onClick={() => correr(() => crearDatoAccion(nuevo), () => setNuevo(''))}>Agregar</button>
      </div>
      {datos.length === 0 && <p style={{ color: '#5c6d66' }}>Todavía no hay datos extras.</p>}
      {datos.map((d) => (
        <div key={d.id} style={{ ...tarjeta, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link href={`/productos/extras/${d.id}`} style={{ flex: '1 1 220px', textDecoration: 'none', color: 'inherit' }}>
            <b>{d.nombre}</b><br /><small style={{ color: '#5c6d66' }}>{d.productos} productos · {d.valores} valores · tocá para ver la lista</small>
          </Link>
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => { const n = window.prompt('Nuevo nombre', d.nombre); if (n && n.trim() && n !== d.nombre) correr(() => renombrarDatoAccion(d.id, n)); }}>Renombrar</button>
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => { if (window.confirm(`¿Quitar «${d.nombre}»? Los valores cargados quedan guardados, pero dejan de mostrarse.`)) correr(() => quitarDatoAccion(d.id)); }}>Quitar</button>
        </div>
      ))}
    </div>
  );
}
