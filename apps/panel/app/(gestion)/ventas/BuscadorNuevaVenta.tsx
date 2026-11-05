'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { boton, campo, tarjeta } from '../../../lib/estilos.ts';
import { buscarClientesAccion } from './acciones.ts';

interface Cliente { id: string; nombre: string; saldo: string; esConsumidorFinal: boolean }
const TIPOS: [string, string][] = [['remito', 'Remito'], ['factura_b', 'Factura B'], ['factura_a', 'Factura A'], ['sin_comprobante', 'Sin comprobante']];

/** Elegir cliente y tipo de comprobante y pasar directo a una venta nueva. */
export default function BuscadorNuevaVenta() {
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('remito');
  const [res, setRes] = useState<Cliente[]>([]);
  const turno = useRef(0);
  useEffect(() => {
    const mio = ++turno.current;
    const t = setTimeout(async () => {
      const r = await buscarClientesAccion(q);
      if (mio === turno.current) setRes(r);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={tarjeta}>
      <b>Nueva venta</b>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nombre, CUIT o teléfono" style={{ ...campo, flex: '2 1 240px', marginTop: 0 }} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ ...campo, flex: '1 1 150px', marginTop: 0 }}>
          {TIPOS.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}
        </select>
      </div>
      <div style={{ marginTop: 8 }}>
        {res.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #d3e6de' }}>
            <span>{c.nombre}{Number(c.saldo) > 0 ? <span style={{ color: '#b4571a', fontSize: 12 }}> · debe ${c.saldo}</span> : null}</span>
            <Link href={`/ventas/nueva?cliente=${c.id}&comprobante=${tipo}`} style={{ ...boton, textDecoration: 'none', padding: '6px 12px' }}>Vender →</Link>
          </div>
        ))}
        {res.length === 0 && <div style={{ fontSize: 13, color: '#5c6d66' }}>No hay clientes con esa búsqueda.</div>}
      </div>
    </div>
  );
}
