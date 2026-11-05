'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { boton, botonSecundario, campo, tarjeta } from '../../../lib/estilos.ts';
import { buscarClientesAccion } from './acciones.ts';

interface Cliente { id: string; nombre: string; saldo: string; esConsumidorFinal: boolean; cuentaCorriente: boolean }
const TIPOS: [string, string][] = [['remito', 'Remito'], ['factura_b', 'Factura B'], ['factura_a', 'Factura A'], ['sin_comprobante', 'Sin comprobante']];

/** Elegir cliente y tipo de comprobante y pasar directo a una venta nueva. */
export default function BuscadorNuevaVenta() {
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('remito');
  const [res, setRes] = useState<Cliente[]>([]);
  const [enCuenta, setEnCuenta] = useState(false);
  const turno = useRef(0);
  useEffect(() => {
    const mio = ++turno.current;
    // Sin texto no se lista a nadie: aparecen recién cuando se escribe.
    if (q.trim() === '') { setRes([]); return; }
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
      <label style={{ display: 'block', margin: '8px 0', fontSize: 14 }}>
        <input type="checkbox" checked={enCuenta} onChange={(e) => setEnCuenta(e.target.checked)} /> Dejar en cuenta corriente (se paga $0)
      </label>
      <div style={{ marginTop: 4 }}>
        {q.trim() === '' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#5c6d66' }}>Escribí para buscar un cliente, o vendé directo:</span>
            <Link href={`/ventas/nueva?comprobante=${tipo}`} style={{ ...botonSecundario, textDecoration: 'none', padding: '6px 12px' }}>Consumidor final →</Link>
          </div>
        ) : (
          <>
            {res.map((c) => {
              const cc = enCuenta && c.cuentaCorriente;
              return (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #d3e6de' }}>
                  <span>
                    {c.nombre}{Number(c.saldo) > 0 ? <span style={{ color: '#b4571a', fontSize: 12 }}> · debe ${c.saldo}</span> : null}
                    {enCuenta && !c.cuentaCorriente && <span style={{ color: '#8a6d00', fontSize: 12 }}> · {c.esConsumidorFinal ? 'el consumidor final no tiene cuenta corriente' : 'su categoría no tiene cuenta corriente'}</span>}
                  </span>
                  <Link href={`/ventas/nueva?cliente=${c.id}&comprobante=${tipo}${cc ? '&cc=1' : ''}`} style={{ ...boton, textDecoration: 'none', padding: '6px 12px' }}>{cc ? 'Vender en cuenta →' : 'Vender →'}</Link>
                </div>
              );
            })}
            {res.length === 0 && <div style={{ fontSize: 13, color: '#5c6d66' }}>No hay clientes con esa búsqueda.</div>}
          </>
        )}
      </div>
    </div>
  );
}
