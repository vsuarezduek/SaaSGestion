import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listarRubros, listasDePrecios, obtenerProducto } from '../../../../lib/catalogo.ts';
import { datosExtraConValores, proveedoresParaProducto } from '../../../../lib/extras.ts';
import { historialDeProducto, type MovimientoHistorial } from '../../../../lib/historialProducto.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { movimientosDeStock } from '../../../../lib/stock.ts';
import FormularioProducto from '../FormularioProducto.tsx';
import StockProducto from '../StockProducto.tsx';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [p, listas, rubros, movs, proveedores, datosExtra, hist] = await Promise.all([obtenerProducto(s, id), listasDePrecios(s), listarRubros(s), movimientosDeStock(s, id), proveedoresParaProducto(s), datosExtraConValores(s), historialDeProducto(s, id)]);
  if (!p) notFound();
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{p.nombre}</h1>
      <StockProducto
        productoId={p.id} stock={p.stock} minimo={p.stockMinimo} unidad={p.unidad}
        filas={movs.map((m) => ({ id: m.id, fecha: m.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, cantidad: m.cantidad, concepto: m.concepto ?? '', revertido: m.revertido, usuario: m.usuario ?? '' }))}
      />
      <FormularioProducto
        listas={listas}
        proveedores={proveedores}
        datosExtra={datosExtra}
        rubros={rubros.filter((r) => r.activo || r.id === p.rubroId)}
        inicial={{ ...p, id: p.id, codigo: p.codigo ?? '', rubroId: p.rubroId ?? '', tipo: p.tipo ?? '', urlWeb: p.urlWeb ?? '', proveedorId: p.proveedorId ?? '' }}
      />
      <Historial titulo="Historial de ventas" total={hist.totalVendido} filas={hist.ventas} base="/ventas" unidad={p.unidad} />
      <Historial titulo="Historial de compras" total={hist.totalComprado} filas={hist.compras} base="/compras" unidad={p.unidad} />
    </main>
  );
}

const celda = { padding: '5px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 13 };

function Historial({ titulo, total, filas, base, unidad }: { titulo: string; total: string; filas: MovimientoHistorial[]; base: string; unidad: string }) {
  return (
    <details style={{ background: '#fff', border: '1px solid #d3e6de', borderRadius: 12, padding: '10px 16px', marginBottom: 14, maxWidth: 720 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{titulo} · {formatearCantidad(total)} {unidad} en total</summary>
      {filas.length === 0 ? <p style={{ color: '#5c6d66' }}>Todavía no hay movimientos.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead><tr><th style={celda}>Fecha</th><th style={celda}>N°</th><th style={celda}>Con</th><th style={celda}>Cantidad</th><th style={celda}>Importe</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id + f.numero + f.cantidad} style={{ opacity: f.estado === 'anulada' ? 0.5 : 1 }}>
                <td style={celda}>{f.fecha.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td>
                <td style={celda}><Link href={`${base}/${f.id}`}>N° {f.numero}</Link>{f.comprobante === 'nota_credito' ? ' (nota de crédito)' : ''}{f.estado === 'anulada' ? ' (anulada)' : ''}</td>
                <td style={celda}>{f.contraparte}</td>
                <td style={celda}>{formatearCantidad(f.cantidad)}</td>
                <td style={celda}>{formatearPesos(aCentavos(f.importe))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
