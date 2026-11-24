'use client';
import Link from 'next/link';
import type { FilaProducto } from '../../../lib/catalogo.ts';
import { aCentavos, estadoStock, formatearCantidad, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { Th, useOrden } from '../Orden.tsx';

const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 14 };
const num = (t: string | undefined) => (t === undefined ? null : Number(t));

/** Tabla del listado con filtros: cada columna se ordena con un click (un segundo click invierte). */
export default function TablaProductos({ filas, listas }: { filas: FilaProducto[]; listas: { id: string; nombre: string }[] }) {
  const claves: Record<string, (f: FilaProducto) => string | number | null> = {
    codigo: (f) => f.codigo, nombre: (f) => f.nombre, rubro: (f) => f.rubro, proveedor: (f) => f.proveedor, stock: (f) => Number(f.stock), costo: (f) => Number(f.costo),
  };
  for (const l of listas) claves[`lista:${l.id}`] = (f) => num(f.precios[l.id]);
  const { ordenadas, orden, alternar } = useOrden(filas, claves);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <Th col="codigo" orden={orden} alternar={alternar} estilo={celda}>Código</Th>
          <Th col="nombre" orden={orden} alternar={alternar} estilo={celda}>Producto</Th>
          <Th col="rubro" orden={orden} alternar={alternar} estilo={celda}>Rubro</Th>
          <Th col="proveedor" orden={orden} alternar={alternar} estilo={celda}>Proveedor</Th>
          <Th col="stock" orden={orden} alternar={alternar} estilo={celda}>Stock</Th>
          <Th col="costo" orden={orden} alternar={alternar} estilo={celda}>Costo</Th>
          {listas.map((l) => (<Th key={l.id} col={`lista:${l.id}`} orden={orden} alternar={alternar} estilo={celda}>{l.nombre}</Th>))}
        </tr>
      </thead>
      <tbody>
        {ordenadas.map((f) => {
          const est = estadoStock(f.stock, f.stockMinimo);
          return (
            <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.55 }}>
              <td style={celda}>{f.codigo ?? ''}</td>
              <td style={celda}><Link href={`/productos/${f.id}`} style={{ color: '#1c9764' }}>{f.nombre}</Link></td>
              <td style={celda}>{f.rubro ?? ''}</td>
              <td style={celda}>{f.proveedor ?? ''}</td>
              <td style={{ ...celda, fontWeight: 600, color: est === 'negativo' ? '#b4571a' : est === 'bajo_minimo' ? '#8a6d00' : 'inherit' }}>
                {formatearCantidad(f.stock)}{est !== 'normal' ? ' ⚠' : ''}
              </td>
              <td style={celda}>{formatearPesos(aCentavos(f.costo))}</td>
              {listas.map((l) => (<td key={l.id} style={celda}>{f.precios[l.id] ? formatearPesos(aCentavos(f.precios[l.id]!)) : '—'}</td>))}
            </tr>
          );
        })}
        {filas.length === 0 && (<tr><td style={celda} colSpan={6 + listas.length}>No hay productos con ese filtro.</td></tr>)}
      </tbody>
    </table>
  );
}
