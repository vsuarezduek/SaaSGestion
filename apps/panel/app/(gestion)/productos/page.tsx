import Link from 'next/link';
import { listarProductos, listarRubros, listasDePrecios, tiposDeProducto } from '../../../lib/catalogo.ts';
import { datosExtraConValores, proveedoresParaProducto } from '../../../lib/extras.ts';
import { boton, botonSecundario, campo, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { aCentavos, estadoStock, formatearCantidad, formatearPesos } from '../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

type Params = { q?: string; rubro?: string; tipo?: string; estado?: string; alerta?: string; limite?: string; proveedor?: string; extra?: string; valor?: string };

export default async function Productos({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const limite = Math.min(Number(p.limite) || 50, 500);
  const estado = p.estado === 'archivados' || p.estado === 'todos' ? p.estado : 'activos';
  const [{ filas, total }, listas, rubros, tipos, proveedores, extras] = await Promise.all([
    listarProductos(s, { q: p.q, rubroId: p.rubro || undefined, tipo: p.tipo || undefined, estado, limite, alerta: p.alerta === 'negativo' || p.alerta === 'bajo_minimo' ? p.alerta : undefined,
      proveedorId: p.proveedor || undefined, extraId: p.extra || undefined, extraValor: p.extra && p.valor ? p.valor : undefined }),
    listasDePrecios(s),
    listarRubros(s),
    tiposDeProducto(s),
    proveedoresParaProducto(s),
    datosExtraConValores(s),
  ]);
  const extraElegido = extras.find((x) => x.id === p.extra);
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 14 };
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>Productos</h1>
        <Link href="/productos/nuevo" style={{ ...boton, textDecoration: 'none' }}>+ Producto</Link>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Link href="/productos/masiva" style={{ ...botonSecundario, textDecoration: 'none' }}>Modificar costos masivamente</Link>
        <Link href="/comprobante/listas" style={{ ...botonSecundario, textDecoration: 'none' }}>Descargar listas de precios</Link>
        <Link href="/productos/costos-fijos" style={{ ...botonSecundario, textDecoration: 'none' }}>Costos fijos</Link>
        <Link href="/productos/extras" style={{ ...botonSecundario, textDecoration: 'none' }}>Datos extras</Link>
        <a href="/productos/exportar" style={{ ...botonSecundario, textDecoration: 'none' }}>Exportar CSV</a>
        <Link href="/importar" style={{ ...botonSecundario, textDecoration: 'none' }}>Importar</Link>
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
        <select name="proveedor" defaultValue={p.proveedor ?? ''} style={{ ...campo, flex: '1 1 160px', marginTop: 0 }}>
          <option value="">Todos los proveedores</option>
          {proveedores.map((x) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}
        </select>
        {extras.length > 0 && (
          <select name="extra" defaultValue={p.extra ?? ''} style={{ ...campo, flex: '1 1 140px', marginTop: 0 }}>
            <option value="">Dato extra…</option>
            {extras.map((x) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}
          </select>
        )}
        {extraElegido && (
          <select name="valor" defaultValue={p.valor ?? ''} style={{ ...campo, flex: '1 1 140px', marginTop: 0 }}>
            <option value="">Cualquier valor</option>
            {extraElegido.valores.map((v) => (<option key={v} value={v}>{v}</option>))}
          </select>
        )}
        <select name="estado" defaultValue={estado} style={{ ...campo, flex: '1 1 120px', marginTop: 0 }}>
          <option value="activos">Activos</option>
          <option value="archivados">Archivados</option>
          <option value="todos">Todos</option>
        </select>
        <select name="alerta" defaultValue={p.alerta ?? ''} style={{ ...campo, flex: '1 1 140px', marginTop: 0 }}>
          <option value="">Todo el stock</option><option value="negativo">Stock negativo</option><option value="bajo_minimo">Bajo el mínimo</option>
        </select>
        <button type="submit" style={boton}>Buscar</button>
      </form>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={celda}>Código</th><th style={celda}>Producto</th><th style={celda}>Rubro</th><th style={celda}>Stock</th><th style={celda}>Costo</th>
              {listas.map((l) => (<th key={l.id} style={celda}>{l.nombre}</th>))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.55 }}>
                <td style={celda}>{f.codigo ?? ''}</td>
                <td style={celda}><Link href={`/productos/${f.id}`} style={{ color: '#1c9764' }}>{f.nombre}</Link></td>
                <td style={celda}>{f.rubro ?? ''}</td>
                <td style={{ ...celda, fontWeight: 600, color: estadoStock(f.stock, f.stockMinimo) === 'negativo' ? '#b4571a' : estadoStock(f.stock, f.stockMinimo) === 'bajo_minimo' ? '#8a6d00' : 'inherit' }}>
                  {formatearCantidad(f.stock)}{estadoStock(f.stock, f.stockMinimo) !== 'normal' ? ' ⚠' : ''}
                </td>
                <td style={celda}>{formatearPesos(aCentavos(f.costo))}</td>
                {listas.map((l) => (<td key={l.id} style={celda}>{f.precios[l.id] ? formatearPesos(aCentavos(f.precios[l.id]!)) : '—'}</td>))}
              </tr>
            ))}
            {filas.length === 0 && (<tr><td style={celda} colSpan={5 + listas.length}>No hay productos con ese filtro.</td></tr>)}
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
