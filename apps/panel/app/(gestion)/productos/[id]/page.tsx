import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listarRubros, listasDePrecios, obtenerProducto } from '../../../../lib/catalogo.ts';
import { datosExtraConValores, proveedoresParaProducto } from '../../../../lib/extras.ts';
import { historialDeProducto, type MovimientoHistorial } from '../../../../lib/historialProducto.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { movimientosDeStock } from '../../../../lib/stock.ts';
import { estaMarcadoParaPedir } from '../../../../lib/aPedir.ts';
import { tarjeta } from '../../../../lib/estilos.ts';
import FichaProducto from '../FichaProducto.tsx';
import RecetaProducto from '../receta/RecetaProducto.tsx';
import StockProducto from '../StockProducto.tsx';
import { formaParteDe, obtenerReceta } from '../../../../lib/recetas.ts';
import { aCentavos, estadoStock, formatearCantidad, formatearPesos, utilidadDesdePrecio } from '../../../../../../packages/dominio/src/index.ts';
import { Seccion } from '../../Orden.tsx';

export const dynamic = 'force-dynamic';

const gris = { fontSize: 12, color: '#5c6d66' } as const;
const verde = { color: '#1c9764' } as const;
const chip = { display: 'inline-block', fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#d9f1e6', color: '#1c9764', fontWeight: 600, marginRight: 6, marginTop: 6 } as const;

/**
 * Ficha del producto como el prototipo: resumen (proveedor y rubro clickeables, «Forma parte de», etiquetas) con
 * Marcar para pedir / Modificar / Eliminar, tarjetas de stock, costo y precios con utilidad, libro de stock, receta,
 * ventas y compras del producto y, al final, los datos extras.
 */
export default async function FichaDeProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [p, listas, rubros, movs, proveedores, datosExtra, hist, receta, marcado, usos] = await Promise.all([obtenerProducto(s, id), listasDePrecios(s), listarRubros(s), movimientosDeStock(s, id), proveedoresParaProducto(s), datosExtraConValores(s), historialDeProducto(s, id), obtenerReceta(s, id), estaMarcadoParaPedir(s, id), formaParteDe(s, id)]);
  if (!p) notFound();
  const proveedor = proveedores.find((x) => x.id === p.proveedorId);
  const rubro = rubros.find((r) => r.id === p.rubroId);
  const est = estadoStock(p.stock, p.stockMinimo);
  const costo = aCentavos(p.costo);
  const etiquetas = [p.vendible && 'Disponible para venta', p.comprable && 'Para compra', p.integrable && 'Para integrar otros', receta && receta.ingredientes.length > 0 && 'Compuesto', p.tipo, marcado && 'Para pedir', p.publicadoWeb && 'En la web', !p.activo && 'Archivado'].filter(Boolean) as string[];

  const cabecera = (
    <>
      <h1 style={{ fontFamily: 'Georgia, serif', margin: 0, fontSize: 24 }}>{p.nombre}</h1>
      <div style={gris}>{[p.codigo && `Código ${p.codigo}`, p.unidad].filter(Boolean).join(' · ')}</div>
      <p style={{ margin: '8px 0 0', fontSize: 14 }}>
        Proveedor: {proveedor ? <Link href={`/proveedores/${proveedor.id}`} style={verde}>{proveedor.nombre}</Link> : '–'}
        {' · '}Rubro: {rubro ? <Link href={`/productos?rubro=${rubro.id}&listado=1`} style={verde}>{rubro.ruta}</Link> : '–'}
      </p>
      {usos.length > 0 && (
        <p style={{ margin: '6px 0 0', fontSize: 14 }}>Forma parte de: {usos.map((u, i) => (<span key={u.id}>{i > 0 && ', '}<Link href={`/productos/${u.id}`} style={verde}>{u.nombre}</Link></span>))}</p>
      )}
      <div>
        {etiquetas.map((t) => (<span key={t} style={chip}>{t}</span>))}
        {p.publicadoWeb && p.urlWeb && <a href={p.urlWeb} target="_blank" rel="noopener noreferrer" style={{ ...verde, fontSize: 13 }}>Ver en la web</a>}
      </div>
    </>
  );

  const tarjetas: [string, string, string?, boolean?][] = [
    ['Stock actual', `${formatearCantidad(p.stock)}`, est !== 'normal' ? (est === 'negativo' ? 'negativo' : 'bajo el mínimo') : undefined, est !== 'normal'],
    ['Stock ideal', formatearCantidad(p.stockIdeal)],
    ['Stock mínimo', formatearCantidad(p.stockMinimo)],
    ['Costo', formatearPesos(costo)],
    ...listas.map((l): [string, string, string?] => {
      const precio = p.precios[l.id];
      if (!precio) return [l.nombre, '—'];
      const u = utilidadDesdePrecio(costo, aCentavos(precio), p.iva);
      return [l.nombre, formatearPesos(aCentavos(precio)), u === null ? undefined : `utilidad ${u.toFixed(1).replace('.', ',')}%`];
    }),
    ['Unidades vendidas', formatearCantidad(hist.totalVendido)],
  ];
  const numeros = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
      {tarjetas.map(([t, v, sub, w]) => (
        <div key={t} style={{ ...tarjeta, marginBottom: 0, padding: 12 }}>
          <div style={gris}>{t}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: w ? '#b4571a' : undefined }}>{v}</div>
          {sub && <div style={gris}>{sub}</div>}
        </div>
      ))}
    </div>
  );

  const conExtras = datosExtra;
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <Link href="/productos" style={{ ...verde, fontSize: 13 }}>← Productos</Link>
      <div style={{ marginTop: 10 }} />
      <FichaProducto
        cabecera={cabecera} numeros={numeros} marcado={p.comprable ? marcado : null}
        formulario={{
          listas, proveedores, datosExtra, rubros: rubros.filter((r) => r.activo || r.id === p.rubroId),
          inicial: { ...p, id: p.id, codigo: p.codigo ?? '', rubroId: p.rubroId ?? '', tipo: p.tipo ?? '', urlWeb: p.urlWeb ?? '', proveedorId: p.proveedorId ?? '' },
        }}
      />
      <StockProducto
        productoId={p.id} stock={p.stock} minimo={p.stockMinimo} unidad={p.unidad}
        filas={movs.map((m) => ({ id: m.id, fecha: m.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, cantidad: m.cantidad, concepto: m.concepto ?? '', revertido: m.revertido, usuario: m.usuario ?? '' }))}
      />
      {receta && <RecetaProducto r={receta} nombre={p.nombre} unidad={p.unidad} />}
      <Historial titulo="Ventas de este producto" total={hist.totalVendido} filas={hist.ventas} base="/ventas" unidad={p.unidad} />
      <Historial titulo="Compras de este producto" total={hist.totalComprado} filas={hist.compras} base="/compras" unidad={p.unidad} />
      {conExtras.length > 0 && (
        <div style={tarjeta}>
          <b>Datos extras</b>
          {conExtras.map((x) => (
            <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderBottom: '1px solid #d3e6de', fontSize: 14 }}>
              <span>{x.nombre}</span>
              {p.extras[x.id] ? <Link href={`/productos?extra=${x.id}&valor=${encodeURIComponent(p.extras[x.id]!)}&listado=1`} style={{ ...verde, fontWeight: 600 }}>{p.extras[x.id]}</Link> : <span style={gris}>–</span>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

const celda = { padding: '5px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 13 };

function Historial({ titulo, total, filas, base, unidad }: { titulo: string; total: string; filas: MovimientoHistorial[]; base: string; unidad: string }) {
  return (
    <Seccion titulo={`${titulo} · ${formatearCantidad(total)} ${unidad}`} estilo={tarjeta}>
      {filas.length === 0 ? <p style={gris}>Todavía no hay movimientos.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Fecha</th><th style={celda}>N°</th><th style={celda}>Con</th><th style={celda}>Cantidad</th><th style={celda}>Importe</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id + f.numero + f.cantidad} style={{ opacity: f.estado === 'anulada' ? 0.5 : 1 }}>
                <td style={celda}>{f.fecha.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td>
                <td style={celda}><Link href={`${base}/${f.id}`} style={verde}>N° {f.numero}</Link>{f.comprobante === 'nota_credito' ? ' (nota de crédito)' : ''}{f.estado === 'anulada' ? ' (anulada)' : ''}</td>
                <td style={celda}>{f.contraparte}</td>
                <td style={celda}>{formatearCantidad(f.cantidad)}</td>
                <td style={celda}>{formatearPesos(aCentavos(f.importe))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}
