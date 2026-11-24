'use client';
import Link from 'next/link';
import { useState } from 'react';
import { tarjeta } from '../../../lib/estilos.ts';
import { Desplegable, Th, useOrden } from '../Orden.tsx';

export interface FilaUltima { id: string; numero: number; fechaMs: number; fecha: string; cliente: string; comprobante: string; cobro: string; total: number; totalTexto: string; anulada: boolean; editable: boolean }

const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
const enlace = { color: '#1c9764' };

/** «Últimas ventas» desplegable y con columnas ordenables con un click (como el prototipo). */
export default function UltimasVentas({ filas, titulo, abiertoInicial, verMas }: { filas: FilaUltima[]; titulo: string; abiertoInicial: boolean; verMas: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const { ordenadas, orden, alternar } = useOrden(filas, {
    numero: (f) => f.numero, fecha: (f) => f.fechaMs, cliente: (f) => f.cliente, comprobante: (f) => f.comprobante, cobro: (f) => f.cobro, total: (f) => f.total,
  });
  return (
    <Desplegable titulo={titulo} abierto={abierto} onCambiar={setAbierto} estilo={{ ...tarjeta, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <Th col="numero" orden={orden} alternar={alternar} estilo={celda}>N°</Th>
          <Th col="fecha" orden={orden} alternar={alternar} estilo={celda}>Fecha</Th>
          <Th col="cliente" orden={orden} alternar={alternar} estilo={celda}>Cliente</Th>
          <Th col="comprobante" orden={orden} alternar={alternar} estilo={celda}>Comprobante</Th>
          <Th col="cobro" orden={orden} alternar={alternar} estilo={celda}>Cobro</Th>
          <Th col="total" orden={orden} alternar={alternar} estilo={celda}>Total</Th>
          <th style={celda}></th>
        </tr></thead>
        <tbody>
          {ordenadas.map((v) => (
            <tr key={v.id} style={{ opacity: v.anulada ? 0.5 : 1 }}>
              <td style={celda}><Link href={`/ventas/${v.id}`} style={enlace}>{v.numero}</Link></td>
              <td style={celda}>{v.fecha}</td>
              <td style={celda}>{v.cliente}</td><td style={celda}>{v.comprobante}{v.anulada ? ' (anulada)' : ''}</td>
              <td style={celda}>{v.cobro}</td><td style={celda}>{v.totalTexto}</td>
              <td style={{ ...celda, whiteSpace: 'nowrap' }}>
                {v.editable && <Link href={`/ventas/nueva?editar=${v.id}`} style={{ ...enlace, marginRight: 10 }}>Editar</Link>}
                <a href={`/comprobante/ventas/${v.id}`} target="_blank" rel="noopener" style={enlace}>Compartir</a>
              </td>
            </tr>
          ))}
          {filas.length === 0 && (<tr><td style={celda} colSpan={7}>Todavía no hay ventas.</td></tr>)}
        </tbody>
      </table>
      {verMas && <Link href="/ventas?todas=1" style={enlace}>Mostrar más</Link>}
    </Desplegable>
  );
}
