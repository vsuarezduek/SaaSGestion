import Link from 'next/link';
import { listarProductos, listarRubros, listasDePrecios, tiposDeProducto } from '../../../lib/catalogo.ts';
import { boton, campo, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { formatearPesos, aCentavos } from '../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

type Params = { q?: string; rubro?: string; tipo?: string; estado?: string; limite?: string };

export default async function Productos({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const limite = Math.min(Number(p.limite) || 50, 500);
  const estado = p.estado === 'archivados' || p.estado === 'todos' ? p.estado : 'activos';
  const [{ filas, total }, listas, rubros, tipos] = await Promise.all([
    listarProductos(s, { q: p.q, rubroId: p.rubro || undefined, tipo: p.tipo || undefined, estado, limite }),
    listasDePrecios(s),
    listarRubros(s),
    tiposDeProducto(s),
  ]);
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 14 };
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>Productos</h1>
        <Link href="/productos/nuevo" style={{ ...boton, textDecoration: 'none' }}>+ Producto</Link>
      </div>
      <form method="get" style={{ ...tarjeta, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input name="q" defaultValue={p.q ?? ''} placeholder="Buscar por nombre, código o tipo" style={{ ...campo, flex: '2 1 220px', marginTop: 0 }} />
        <select name="rubro" defaultValue={p.rubro ?? ''} style={{ ...campo, flex: '1 1 160px', marginTop: 0 }}>
          <option value="">Todos los rubros</option>
          {rubros.filter((r) => r.activo).map((r) => (
            <option key={r.id} value={r.id}>{r.ruta}</option>
          ))}
        </select>
        <select name="tipo" defaultValue={p.tipo ?? ''} style={{ ...campo, flex: '1 1 120px', marginTop: 0 }}>
          <option value="">Todos los tipos</option>
          {tipos.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select name="estado" defaultValue={estado} style={{ ...campo, flex: '1 1 120px', marginTop: 0 }}>
          <option value="activos">Activos</option>
          <option value="archivados">Archivados</option>
          <option value="todos">Todos</option>
        </select>
        <button type="submit" style={boton}>Buscar</button>
      </form>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={celda}>Código</th><th style={celda}>Producto</th><th style={celda}>Rubro</th><th style={celda}>Costo</th>
              {listas.map((l) => (<th key={l.id} style={celda}>{l.nombre}</th>))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.55 }}>
                <td style={celda}>{f.codigo ?? ''}</td>
                <td style={celda}><Link href={`/productos/${f.id}`} style={{ color: '#1c9764' }}>{f.nombre}</Link></td>
                <td style={celda}>{f.rubro ?? ''}</td>
                <td style={celda}>{formatearPesos(aCentavos(f.costo))}</td>
                {listas.map((l) => (<td key={l.id} style={celda}>{f.precios[l.id] ? formatearPesos(aCentavos(f.precios[l.id]!)) : '—'}</td>))}
              </tr>
            ))}
            {filas.length === 0 && (<tr><td style={celda} colSpan={4 + listas.length}>No hay productos con ese filtro.</td></tr>)}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: '#5c6d66' }}>Mostrando {filas.length} de {total}.</p>
        {filas.length < total && (
          <Link href={{ pathname: '/productos', query: { ...p, limite: String(limite + 50) } }} style={{ color: '#1c9764' }}>Mostrar más</Link>
        )}
      </div>
    </main>
  );
}
