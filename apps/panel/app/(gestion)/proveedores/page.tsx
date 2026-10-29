import Link from 'next/link';
import { listarProveedores } from '../../../lib/personas.ts';
import { boton, campo, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';
type Params = { q?: string; estado?: string; limite?: string };

export default async function Proveedores({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const limite = Math.min(Number(p.limite) || 50, 500);
  const estado = p.estado === 'archivados' || p.estado === 'todos' ? p.estado : 'activos';
  const { filas, total } = await listarProveedores(s, { q: p.q, estado, limite });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 14 };
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>Proveedores</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/proveedores/nuevo" style={{ ...boton, textDecoration: 'none' }}>+ Proveedor</Link>
        </div>
      </div>
      <form method="get" style={{ ...tarjeta, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input name="q" defaultValue={p.q ?? ''} placeholder="Buscar por nombre, contacto, categoría o CUIT" style={{ ...campo, flex: '3 1 240px', marginTop: 0 }} />
        <select name="estado" defaultValue={estado} style={{ ...campo, flex: '1 1 120px', marginTop: 0 }}>
          <option value="activos">Activos</option><option value="archivados">Archivados</option><option value="todos">Todos</option>
        </select>
        <button type="submit" style={boton}>Buscar</button>
      </form>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Proveedor</th><th style={celda}>Categoría</th><th style={celda}>Contacto</th><th style={celda}>Teléfono</th><th style={celda}>Saldo</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.55 }}>
                <td style={celda}><Link href={`/proveedores/${f.id}`} style={{ color: '#1c9764' }}>{f.nombre}</Link></td>
                <td style={celda}>{f.categoria ?? ''}</td><td style={celda}>{f.contacto ?? ''}</td><td style={celda}>{f.telefono ?? ''}</td>
                <td style={celda}>{formatearPesos(aCentavos(f.saldo))}</td>
              </tr>
            ))}
            {filas.length === 0 && (<tr><td style={celda} colSpan={5}>No hay proveedores con ese filtro.</td></tr>)}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: '#5c6d66' }}>Mostrando {filas.length} de {total}.</p>
        {filas.length < total && (<Link href={{ pathname: '/proveedores', query: { ...p, limite: String(limite + 50) } }} style={{ color: '#1c9764' }}>Mostrar más</Link>)}
      </div>
    </main>
  );
}
