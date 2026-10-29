import { notFound } from 'next/navigation';
import { listarRubros, listasDePrecios, obtenerProducto } from '../../../../lib/catalogo.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { movimientosDeStock } from '../../../../lib/stock.ts';
import FormularioProducto from '../FormularioProducto.tsx';
import StockProducto from '../StockProducto.tsx';

export const dynamic = 'force-dynamic';

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [p, listas, rubros, movs] = await Promise.all([obtenerProducto(s, id), listasDePrecios(s), listarRubros(s), movimientosDeStock(s, id)]);
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
        rubros={rubros.filter((r) => r.activo || r.id === p.rubroId)}
        inicial={{ ...p, id: p.id, codigo: p.codigo ?? '', rubroId: p.rubroId ?? '', tipo: p.tipo ?? '', urlWeb: p.urlWeb ?? '' }}
      />
    </main>
  );
}
