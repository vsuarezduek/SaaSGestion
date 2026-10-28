import { redirect } from 'next/navigation';
import { conTenant } from '../../../lib/db.ts';
import { botonSecundario, pagina, tarjeta } from '../../../lib/estilos.ts';
import { sesionActual } from '../../../lib/sesion.ts';
import { salirAccion } from '../../ingresar/acciones.ts';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function Panel() {
  const sesion = await sesionActual();
  if (!sesion) redirect('/ingresar');

  // Solo se ve la actividad del propio comercio (la base lo garantiza con Row Level Security).
  const actividad = await conTenant(sesion.tenantId, (c) =>
    c.query<{ creado_en: Date; accion: string; entidad: string }>(
      'SELECT creado_en, accion, entidad FROM auditoria ORDER BY id DESC LIMIT 10',
    ),
  );

  return (
    <main style={pagina}>
      <h1 style={{ fontFamily: 'Georgia, serif', marginBottom: 4 }}>{sesion.comercio}</h1>
      <p style={{ marginTop: 0, color: '#5c6d66' }}>
        {sesion.nombre} · {sesion.rol}
      </p>
      <div style={tarjeta}>
        <b>Actividad reciente</b>
        {actividad.rows.map((f, i) => (
          <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #d3e6de', fontSize: 14 }}>
            {new Date(f.creado_en).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} · {f.accion} · {f.entidad}
          </div>
        ))}
      </div>
      <form action={salirAccion}>
        <button type="submit" style={botonSecundario}>
          Salir
        </button>
      </form>
    </main>
  );
}
