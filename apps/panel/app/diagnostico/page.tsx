import { notFound } from 'next/navigation';
import { conTenant, nombreVariable, pool, urlBase } from '../../lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

type Fila = { clave: string; valor: string; ok?: boolean };

async function diagnosticar(): Promise<Fila[]> {
  const filas: Fila[] = [];
  const variable = nombreVariable();
  filas.push({ clave: 'Variable de conexión usada', valor: variable });
  filas.push({ clave: 'Entorno de Vercel', valor: process.env.VERCEL_ENV ?? '(local)' });
  try {
    const host = new URL(urlBase()).hostname;
    filas.push({ clave: 'Servidor de la base (compará con la rama en Neon)', valor: host });
    const r = await pool().query<{ db: string; usuario: string; tablas: string; migraciones: string | null }>(
      `SELECT current_database() AS db, current_user AS usuario,
              (SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','app'))::text AS tablas,
              (SELECT count(*) FROM _migraciones)::text AS migraciones`,
    ).catch(async () => {
      // Si todavía no existe _migraciones, la base está vacía o sin migrar.
      const v = await pool().query<{ db: string; usuario: string; tablas: string }>(
        `SELECT current_database() AS db, current_user AS usuario,
                (SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','app'))::text AS tablas`,
      );
      return { rows: [{ ...v.rows[0]!, migraciones: null }] };
    });
    const f = r.rows[0]!;
    filas.push({ clave: 'Conexión', valor: 'Conectado', ok: true });
    filas.push({ clave: 'Base de datos', valor: f.db });
    filas.push({ clave: 'Usuario de la conexión', valor: f.usuario });
    filas.push({ clave: 'Tablas', valor: f.tablas });
    filas.push({
      clave: 'Migraciones aplicadas',
      valor: f.migraciones ?? 'ninguna todavía',
      ok: f.migraciones !== null && Number(f.migraciones) > 0,
    });
    if (f.migraciones !== null) {
      // Prueba de aislamiento: un comercio inexistente no debe ver ningún comercio.
      const visibles = await conTenant('00000000-0000-0000-0000-000000000000', (c) =>
        c.query<{ n: string }>('SELECT count(*)::text AS n FROM tenants'),
      );
      filas.push({
        clave: 'Aislamiento por comercio (RLS)',
        valor: visibles.rows[0]!.n === '0' ? 'Correcto: un comercio ajeno no ve datos' : 'REVISAR: se ven filas ajenas',
        ok: visibles.rows[0]!.n === '0',
      });
    }
  } catch (e) {
    filas.push({ clave: 'Conexión', valor: 'ERROR: ' + (e instanceof Error ? e.message : String(e)), ok: false });
  }
  return filas;
}

export default async function Diagnostico() {
  // Nunca se muestra en producción. Se elimina o se protege con login cuando exista.
  if (process.env.VERCEL_ENV === 'production') notFound();
  const filas = await diagnosticar();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Diagnóstico</h1>
      <p>Verifica la conexión a la base de pruebas. No muestra contraseñas.</p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} style={{ borderBottom: '1px solid #d3e6de' }}>
              <td style={{ padding: 8, color: '#5c6d66' }}>{f.clave}</td>
              <td style={{ padding: 8, fontWeight: 600, color: f.ok === false ? '#b4571a' : f.ok ? '#1c9764' : '#212021' }}>{f.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
