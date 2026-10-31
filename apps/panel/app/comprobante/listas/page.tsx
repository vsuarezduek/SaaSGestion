import { listarRubros, listasDePrecios } from '../../../lib/catalogo.ts';
import { datosExtraConValores, proveedoresParaProducto } from '../../../lib/extras.ts';
import { listaDePrecios } from '../../../lib/productosArchivos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { nombreDelComercio } from '../../../lib/ventas.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import BotonImprimir from './BotonImprimir.tsx';
import { filtroDe, type ParamsLista } from './filtro.ts';

export const dynamic = 'force-dynamic';

/** Lista de precios para entregar a los clientes: se imprime o se guarda como PDF desde el navegador, o se baja en CSV. */
export default async function ListaDePrecios({ searchParams }: { searchParams: Promise<ParamsLista> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const [listas, rubros, proveedores, extras, comercio] = await Promise.all([listasDePrecios(s), listarRubros(s), proveedoresParaProducto(s), datosExtraConValores(s), nombreDelComercio(s)]);
  const filtro = filtroDe(p, listas);
  const lista = await listaDePrecios(s, filtro);
  const q = new URLSearchParams();
  for (const l of filtro.listaIds) q.append('listas', l);
  for (const k of ['rubro', 'proveedor', 'extra', 'valor', 'stock', 'mstock'] as const) if (p[k]) q.set(k, p[k]!);
  const consulta = q.toString();
  const extraElegido = extras.find((x) => x.id === p.extra);
  const celda = { padding: '5px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 14 };
  const campo = { font: 'inherit', padding: 6, border: '1px solid #d3e6de', borderRadius: 6, marginRight: 8 };
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <style>{'@media print { .no-imprimir { display: none !important; } body { background: #fff !important; } main { padding: 0 !important; } }'}</style>
      <form method="get" className="no-imprimir" style={{ background: '#fff', border: '1px solid #d3e6de', borderRadius: 12, padding: 14, marginBottom: 16, lineHeight: 2.2 }}>
        <b>Lista de precios</b><br />
        <span>Precios: </span>
        {listas.map((l) => (
          <label key={l.id} style={{ marginRight: 10 }}><input type="checkbox" name="listas" value={l.id} defaultChecked={filtro.listaIds.includes(l.id)} /> {l.nombre}</label>
        ))}
        <br />
        <select name="rubro" defaultValue={p.rubro ?? ''} style={campo}><option value="">Todos los rubros</option>{rubros.filter((r) => r.activo).map((r) => (<option key={r.id} value={r.id}>{r.ruta}</option>))}</select>
        <select name="proveedor" defaultValue={p.proveedor ?? ''} style={campo}><option value="">Todos los proveedores</option>{proveedores.map((x) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}</select>
        <select name="extra" defaultValue={p.extra ?? ''} style={campo}><option value="">Cualquier dato extra</option>{extras.map((x) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}</select>
        {extraElegido && (
          <select name="valor" defaultValue={p.valor ?? ''} style={campo}><option value="">Con cualquier valor</option>{extraElegido.valores.map((v) => (<option key={v} value={v}>{v}</option>))}</select>
        )}
        <br />
        <label style={{ marginRight: 12 }}><input type="checkbox" name="stock" value="1" defaultChecked={p.stock === '1'} /> Solo lo que hay en stock</label>
        <label style={{ marginRight: 12 }}><input type="checkbox" name="mstock" value="1" defaultChecked={p.mstock === '1'} /> Mostrar el stock</label>
        <button type="submit" style={{ ...campo, background: '#1c9764', color: '#fff', border: 0, cursor: 'pointer' }}>Actualizar</button>
        <br />
        <BotonImprimir /> <a href={`/comprobante/listas/csv?${consulta}`} style={{ marginLeft: 10 }}>Bajar CSV</a>
      </form>
      <div style={{ fontSize: 24, fontFamily: 'Georgia, serif' }}><b>{comercio}</b></div>
      <div style={{ color: '#5c6d66', marginBottom: 10 }}>Lista de precios · {new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} · precios con IVA incluido</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={celda}>Código</th><th style={celda}>Producto</th><th style={celda}>Rubro</th>{lista.listas.map((n) => (<th key={n} style={celda}>{n}</th>))}{lista.mostrarStock && <th style={celda}>Stock</th>}</tr></thead>
        <tbody>
          {lista.filas.map((f, i) => (
            <tr key={i}>
              <td style={celda}>{f.codigo}</td><td style={celda}>{f.nombre}</td><td style={celda}>{f.rubro}</td>
              {f.precios.map((x, j) => (<td key={j} style={celda}>{x ? formatearPesos(aCentavos(x)) : '–'}</td>))}
              {lista.mostrarStock && <td style={celda}>{formatearCantidad(f.stock)} {f.unidad}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {lista.filas.length === 0 && <p style={{ color: '#5c6d66' }}>No hay productos con ese filtro.</p>}
    </main>
  );
}
