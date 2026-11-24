'use client';
import Link from 'next/link';
import { useState } from 'react';
import { tarjeta } from '../../../lib/estilos.ts';
import { Desplegable, Th, useOrden } from '../Orden.tsx';

export interface FilaUltimaCompra { id: string; numero: number; fechaMs: number; fecha: string; proveedor: string; comprobante: string; categoria: string; pago: string; total: number; totalTexto: string; anulada: boolean; editable: boolean }

const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
const enlace = { color: '#1c9764' };

/** «Últimas compras» desplegable y con columnas ordenables con un click (como el prototipo). */
export default function UltimasCompras({ filas, titulo, abiertoInicial, verMas }: { filas: FilaUltimaCompra[]; titulo: string; abiertoInicial: boolean; verMas: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const { ordenadas, orden, alternar } = useOrden(filas, {
    numero: (f) => f.numero, fecha: (f) => f.fechaMs, proveedor: (f) => f.proveedor, comprobante: (f) => f.comprobante, categoria: (f) => f.categoria, pago: (f) => f.pago, total: (f) => f.total,
  });
  return (
    <Desplegable titulo={titulo} abierto={abierto} onCambiar={setAbierto} estilo={{ ...tarjeta, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <Th col="numero" orden={orden} alternar={alternar} estilo={celda}>N°</Th>
          <Th col="fecha" orden={orden} alternar={alternar} estilo={celda}>Fecha</Th>
          <Th col="proveedor" orden={orden} alternar={alternar} estilo={celda}>Proveedor</Th>
          <Th col="comprobante" orden={orden} alternar={alternar} estilo={celda}>Comprobante</Th>
          <Th col="categoria" orden={orden} alternar={alternar} estilo={celda}>Categoría</Th>
          <Th col="pago" orden={orden} alternar={alternar} estilo={celda}>Pago</Th>
          <Th col="total" orden={orden} alternar={alternar} estilo={celda}>Total</Th>
          <th style={celda}></th>
        </tr></thead>
        <tbody>
          {ordenadas.map((v) => (
            <tr key={v.id} style={{ opacity: v.anulada ? 0.5 : 1 }}>
              <td style={celda}><Link href={`/compras/${v.id}`} style={enlace}>{v.numero}</Link></td>
              <td style={celda}>{v.fecha}</td>
              <td style={celda}>{v.proveedor}</td><td style={celda}>{v.comprobante}{v.anulada ? ' (anulada)' : ''}</td>
              <td style={celda}>{v.categoria}</td><td style={celda}>{v.pago}</td><td style={celda}>{v.totalTexto}</td>
              <td style={{ ...celda, whiteSpace: 'nowrap' }}>
                {v.editable && <Link href={`/compras/nueva?editar=${v.id}`} style={enlace}>Editar</Link>}
              </td>
            </tr>
          ))}
          {filas.length === 0 && (<tr><td style={celda} colSpan={8}>Todavía no hay compras.</td></tr>)}
        </tbody>
      </table>
      {verMas && <Link href="/compras?todas=1" style={enlace}>Mostrar más</Link>}
    </Desplegable>
  );
}
