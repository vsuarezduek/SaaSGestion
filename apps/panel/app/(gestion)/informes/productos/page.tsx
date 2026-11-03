import Link from 'next/link';
import { formatearCantidad, formatearPesos, aCentavos } from '../../../../../../packages/dominio/src/index.ts';
import { listarRubros } from '../../../../lib/catalogo.ts';
import { datosExtraConValores, proveedoresParaProducto } from '../../../../lib/extras.ts';
import { botonSecundario, campo, pagina } from '../../../../lib/estilos.ts';
import { informeDeProductos, SIN_VALOR, type ParamsInformeProductos } from '../../../../lib/informeProductos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';

export default async function InformeProductos({ searchParams }: { searchParams: Promise<ParamsInformeProductos> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const [r, rubros, proveedores, extras] = await Promise.all([informeDeProductos(s, p), listarRubros(s), proveedoresParaProducto(s), datosExtraConValores(s)]);
  const extraElegido = extras.find((x) => x.id === p.extra);
  const consulta = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  const celda = { padding: '5px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 14 };
  return (
    <main style={{ ...pagina, maxWidth: 900 }}>
      <p style={{ margin: 0 }}><Link href="/informes" style={{ color: '#1c9764' }}>← Informes</Link></p>
      <h1 style={{ marginTop: 4 }}>Informe de productos</h1>
      <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input name="q" placeholder="Buscar…" defaultValue={p.q ?? ''} style={{ ...campo, width: 160, marginTop: 0 }} />
        <select name="rubro" defaultValue={p.rubro ?? ''} style={{ ...campo, width: 'auto', marginTop: 0 }}><option value="">Todos los rubros</option>{rubros.filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.ruta}</option>)}</select>
        <select name="proveedor" defaultValue={p.proveedor ?? ''} style={{ ...campo, width: 'auto', marginTop: 0 }}><option value="">Todos los proveedores</option>{proveedores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        <select name="extra" defaultValue={p.extra ?? ''} style={{ ...campo, width: 'auto', marginTop: 0 }}><option value="">Cualquier dato extra</option>{extras.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        {extraElegido && <select name="valor" defaultValue={p.valor ?? ''} style={{ ...campo, width: 'auto', marginTop: 0 }}><option value="">Con cualquier valor</option><option value={SIN_VALOR}>Sin valor</option>{extraElegido.valores.map((v) => <option key={v} value={v}>{v}</option>)}</select>}
        <select name="venta" defaultValue={p.venta ?? ''} style={{ ...campo, width: 'auto', marginTop: 0 }}><option value="">Se vendan o no</option><option value="si">Disponibles para la venta</option><option value="no">No se venden</option></select>
        <select name="estado" defaultValue={p.estado ?? 'activos'} style={{ ...campo, width: 'auto', marginTop: 0 }}><option value="activos">Activos</option><option value="archivados">Archivados</option><option value="todos">Todos</option></select>
        <select name="alerta" defaultValue={p.alerta ?? ''} style={{ ...campo, width: 'auto', marginTop: 0 }}><option value="">Cualquier stock</option><option value="negativo">Stock negativo</option><option value="bajo_minimo">Bajo el mínimo</option></select>
        <button style={{ ...botonSecundario, padding: '9px 14px' }}>Ver</button>
        <a href={`/informes/productos/csv?${consulta}`} style={{ ...botonSecundario, textDecoration: 'none' }}>Descargar CSV</a>
      </form>
      <p style={{ color: '#5c6d66', marginTop: 0 }}>{r.total} producto{r.total === 1 ? '' : 's'}{r.total > r.filas.length ? ` (se muestran los primeros ${r.filas.length}; afiná el filtro)` : ''}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={celda}>Código</th><th style={celda}>Producto</th><th style={celda}>Rubro</th><th style={{ ...celda, textAlign: 'right' }}>Stock</th><th style={{ ...celda, textAlign: 'right' }}>Costo</th></tr></thead>
        <tbody>
          {r.filas.map((f) => (
            <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.5 }}>
              <td style={celda}>{f.codigo}</td><td style={celda}><Link href={`/productos/${f.id}`} style={{ color: 'inherit' }}>{f.nombre}</Link></td><td style={celda}>{f.rubro ?? ''}</td>
              <td style={{ ...celda, textAlign: 'right' }}>{formatearCantidad(f.stock)} {f.unidad}</td><td style={{ ...celda, textAlign: 'right' }}>{formatearPesos(aCentavos(f.costo))}</td>
            </tr>
          ))}
          {r.filas.length === 0 && <tr><td style={celda} colSpan={5}>No hay productos con esos filtros.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
