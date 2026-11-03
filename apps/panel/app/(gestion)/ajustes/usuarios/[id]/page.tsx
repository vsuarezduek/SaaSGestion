import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listarCajas } from '../../../../../lib/cajas.ts';
import { tarjeta } from '../../../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import { actividadDeUsuario, obtenerUsuario } from '../../../../../lib/usuarios.ts';
import { formatearPesos } from '../../../../../../../packages/dominio/src/index.ts';
import FormUsuario from '../FormUsuario.tsx';

export const dynamic = 'force-dynamic';

export default async function EditarUsuario({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [u, cajas, act] = await Promise.all([obtenerUsuario(s, id), listarCajas(s), actividadDeUsuario(s, id)]);
  if (!u || !act) notFound();
  const cuando = (d: Date) => new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' });
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <p style={{ margin: 0 }}><Link href="/ajustes/usuarios" style={{ color: '#1c9764' }}>← Usuarios</Link></p>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{u.nombre}{u.activo ? '' : ' (desactivado)'}</h1>
      <FormUsuario inicial={{ id: u.id, nombre: u.nombre, email: u.email ?? '', rol: u.rol, permisos: u.permisos, cajasVisibles: u.cajasVisibles, activo: u.activo, tienePin: u.tienePin, tieneContrasena: u.tieneContrasena }}
        cajas={cajas.map((k) => ({ id: k.id, nombre: k.nombre }))} esYo={u.id === s.usuarioId} puedeAdministradores={s.rol === 'administrador'} />
      <div style={tarjeta}>
        <b>Actividad</b>
        <div style={{ fontSize: 14, margin: '6px 0' }}>
          Hoy: {act.ventasHoy.operaciones} ventas por {formatearPesos(act.ventasHoy.total)} · Este mes: {act.ventasMes.operaciones} ventas por {formatearPesos(act.ventasMes.total)}
        </div>
        {u.ultimoIngreso && <div style={{ fontSize: 13, color: '#5c6d66' }}>Último ingreso: {cuando(u.ultimoIngreso)}</div>}
        {act.ultimas.map((a, i) => <div key={i} style={{ fontSize: 14, padding: '4px 0', borderTop: '1px solid #d3e6de' }}><span style={{ color: '#5c6d66' }}>{cuando(a.cuando)}</span> · {a.enlace ? <Link href={a.enlace} style={{ color: 'inherit' }}>{a.texto}</Link> : a.texto}</div>)}
      </div>
    </main>
  );
}
