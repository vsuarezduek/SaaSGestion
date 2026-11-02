'use client';
// Mercadería a pedir agrupada por proveedor: se tildan los productos y se arma la compra con esa selección.
import Link from 'next/link';
import { useState } from 'react';
import { botonSecundario } from '../../../lib/estilos.ts';

export interface ItemPedir { id: string; nombre: string; stock: string; cantidad: string; unidad: string }
export interface GrupoPedir { proveedorId: string | null; proveedor: string; items: ItemPedir[] }

export default function PedirMercaderia({ grupos }: { grupos: GrupoPedir[] }) {
  const [marcados, setMarcados] = useState<Record<string, boolean>>(() => Object.fromEntries(grupos.flatMap((g) => g.items.map((i) => [i.id, true]))));
  return (
    <>
      {grupos.map((g) => {
        const ids = g.items.filter((i) => marcados[i.id]).map((i) => i.id);
        const url = `/compras/nueva?faltantes=1${g.proveedorId ? `&proveedor=${g.proveedorId}` : ''}&ids=${ids.join(',')}`;
        return (
          <div key={g.proveedorId ?? 'sin'} style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 14 }}>{g.proveedor}</b>
              {ids.length > 0 && <Link href={url} style={{ ...botonSecundario, textDecoration: 'none', padding: '4px 10px', fontSize: 13 }}>Armar compra ({ids.length})</Link>}
            </div>
            {g.items.map((i) => (
              <label key={i.id} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 14 }}>
                <input type="checkbox" checked={!!marcados[i.id]} onChange={(e) => setMarcados({ ...marcados, [i.id]: e.target.checked })} />
                <span>{i.nombre} · hay {i.stock}, pedir {i.cantidad} {i.unidad}</span>
              </label>
            ))}
          </div>
        );
      })}
    </>
  );
}
