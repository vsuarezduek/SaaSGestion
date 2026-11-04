import { aviso, boton, tarjeta } from '../../../../lib/estilos.ts';
import { enviosRecientes, obtenerConexion } from '../../../../lib/correo.ts';
import { proveedoresDisponibles } from '../../../../lib/correoOauth.ts';
import { exigir } from '../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import Desconectar from './Desconectar.tsx';

export const dynamic = 'force-dynamic';
const NOMBRES = { google: 'Gmail / Google Workspace', microsoft: 'Outlook / Microsoft 365' } as const;

export default async function Correo({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const s = await sesionObligatoria();
  exigir(s, 'ajustes');
  const q = await searchParams;
  const [conexion, envios] = await Promise.all([obtenerConexion(s), enviosRecientes(s)]);
  const disponibles = proveedoresDisponibles();
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 13, textAlign: 'left' as const };
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Correo</h1>
      {q.ok && <div style={aviso}>Casilla conectada.</div>}
      {q.error && <div style={{ ...aviso, background: '#fbeae0', color: '#b4571a' }}>{q.error}</div>}
      <div style={tarjeta}>
        <b>Enviar comprobantes por mail</b>
        <p style={{ fontSize: 14 }}>Conectá la casilla desde la que querés enviar: los comprobantes de venta y de compra salen desde ahí, con tu nombre. Solo pedimos permiso para <b>enviar</b>; no leemos tu correo ni guardamos tu contraseña. Podés desconectarla cuando quieras.</p>
        {conexion ? (
          <>
            <p style={{ fontSize: 14 }}>Conectada: <b>{conexion.cuenta}</b> ({NOMBRES[conexion.proveedor]}), desde el {conexion.conectadoEn.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}.</p>
            <Desconectar />
          </>
        ) : disponibles.length === 0 ? (
          <p style={{ fontSize: 14, color: '#b4571a' }}>El envío por mail todavía no está habilitado en esta instalación. Hay que cargar las credenciales de Google o Microsoft (ver docs/CORREO.md).</p>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {disponibles.map((p) => (<a key={p} href={`/api/correo/conectar/${p}`} style={{ ...boton, textDecoration: 'none' }}>Conectar {NOMBRES[p]}</a>))}
          </div>
        )}
        <p style={{ fontSize: 12, color: '#5c6d66' }}>Las respuestas de tus clientes llegan al mail de la empresa (Ajustes → Empresa y marca), si lo cargaste. Máximo 60 mails por hora.</p>
      </div>
      {envios.length > 0 && (
        <div style={{ ...tarjeta, overflowX: 'auto' }}>
          <b>Últimos envíos</b>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={celda}>Fecha</th><th style={celda}>Para</th><th style={celda}>Asunto</th><th style={celda}>Resultado</th></tr></thead>
            <tbody>
              {envios.map((e, i) => (
                <tr key={i}>
                  <td style={celda}>{e.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td><td style={celda}>{e.para}</td><td style={celda}>{e.asunto}</td>
                  <td style={celda}>{e.resultado === 'enviado' ? 'Enviado' : `Error${e.detalle ? ': ' + e.detalle : ''}`}{e.usuario ? ` · ${e.usuario}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
