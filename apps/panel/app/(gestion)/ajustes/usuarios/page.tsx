import Link from 'next/link';
import { botonSecundario, tarjeta } from '../../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { listarUsuarios } from '../../../../lib/usuarios.ts';

export const dynamic = 'force-dynamic';

const ROL: Record<string, string> = { administrador: 'Administrador', encargada: 'Encargada', atencion: 'Atención al público', cocina: 'Cocina', marketing: 'Marketing' };

export default async function Usuarios() {
  const s = await sesionObligatoria();
  const usuarios = await listarUsuarios(s);
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>Usuarios y permisos</h1>
        <Link href="/ajustes/usuarios/nuevo" style={{ ...botonSecundario, textDecoration: 'none' }}>+ Usuario</Link>
      </div>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Nombre</th><th style={celda}>Tipo</th><th style={celda}>Extras</th><th style={celda}>Acceso</th><th style={celda}></th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} style={{ opacity: u.activo ? 1 : 0.5 }}>
                <td style={celda}><Link href={`/ajustes/usuarios/${u.id}`} style={{ color: '#1c9764' }}>{u.nombre}</Link>{u.id === s.usuarioId ? ' (vos)' : ''}</td>
                <td style={celda}>{ROL[u.rol] ?? u.rol}</td>
                <td style={celda}>{u.rol === 'administrador' ? 'Todo' : u.permisos.join(', ') || '–'}</td>
                <td style={celda}>{[u.tieneContrasena && 'contraseña', u.tienePin && 'PIN'].filter(Boolean).join(' + ') || 'sin acceso'}</td>
                <td style={celda}>{u.activo ? '' : 'Desactivado'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
