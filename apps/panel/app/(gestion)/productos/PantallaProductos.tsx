'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { boton, botonSecundario, campo, tarjeta } from '../../../lib/estilos.ts';
import type { FilaProducto } from '../../../lib/catalogo.ts';
import { aCentavos, estadoStock, formatearCantidad, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { buscarProductosAccion } from './acciones.ts';

interface Props {
  tipos: string[];
  /** La primera lista de precios (minorista): es el precio que se muestra en cada resultado, como en el prototipo. */
  lista: { id: string; nombre: string } | null;
  puedeDescargar: boolean;
  puedeMasiva: boolean;
}

const gris = { fontSize: 12, color: '#5c6d66' } as const;
const igual: CSSProperties = { fontSize: 14, fontFamily: 'inherit', textDecoration: 'none' };

/** Arriba de Productos, como el prototipo: buscador por nombre o código, tipo, acciones y resultados mientras se escribe. */
export default function PantallaProductos({ tipos, lista, puedeDescargar, puedeMasiva }: Props) {
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('');
  const [res, setRes] = useState<FilaProducto[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const turno = useRef(0);
  useEffect(() => {
    const mio = ++turno.current;
    if (q.trim() === '' && tipo === '') { setRes(null); setBuscando(false); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await buscarProductosAccion(q, tipo);
      if (mio === turno.current) { setRes(r); setBuscando(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, tipo]);

  return (
    <div style={tarjeta}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por nombre o código" style={{ ...campo, marginTop: 0, flex: '3 1 260px' }} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo" style={{ ...campo, marginTop: 0, flex: '1 1 150px' }}>
          <option value="">Todos los tipos</option>
          {tipos.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <Link href="/productos/nuevo" style={{ ...boton, ...igual }}>+ Nuevo</Link>
        {puedeMasiva && <Link href="/ajustes/masiva" style={{ ...botonSecundario, ...igual }}>Modificar masivamente</Link>}
        <Link href="/comprobante/listas" style={{ ...botonSecundario, ...igual }}>Descargar listas</Link>
        {puedeDescargar && <a href="/productos/exportar" style={{ ...botonSecundario, ...igual }}>Exportar</a>}
        {puedeDescargar && <Link href="/ajustes/importar" style={{ ...botonSecundario, ...igual }}>Importar</Link>}
      </div>
      {res === null && buscando && <div style={gris}>Buscando…</div>}
      {res && (
        <div style={{ marginTop: 6 }}>
          {res.length > 8 && <div style={gris}>{res.length === 40 ? 'Más de 40' : res.length} resultados</div>}
          {res.map((p) => {
            const est = estadoStock(p.stock, p.stockMinimo);
            const precio = lista ? p.precios[lista.id] : undefined;
            return (
              <Link key={p.id} href={`/productos/${p.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 4px', borderBottom: '1px solid #d3e6de', fontSize: 14, color: 'inherit', textDecoration: 'none', opacity: p.activo ? 1 : 0.55 }}>
                <span style={{ flex: 1 }}>
                  <b style={{ color: '#1c9764' }}>{p.nombre}</b>
                  <div style={gris}>
                    {[p.codigo, p.proveedor].filter(Boolean).join(' · ')}{p.codigo || p.proveedor ? ' · ' : ''}
                    <span style={{ color: est === 'negativo' ? '#b4571a' : est === 'bajo_minimo' ? '#8a6d00' : undefined }}>stock {formatearCantidad(p.stock)}{est !== 'normal' ? ' ⚠' : ''}</span>
                  </div>
                </span>
                <span style={{ textAlign: 'right' }}>
                  {precio ? formatearPesos(aCentavos(precio)) : '—'}
                  <div style={gris}>costo {formatearPesos(aCentavos(p.costo))}</div>
                </span>
              </Link>
            );
          })}
          {res.length === 0 && !buscando && (
            <div style={{ ...gris, padding: 6 }}>No hay productos con esa búsqueda. <Link href="/productos/nuevo" style={{ color: '#1c9764', fontWeight: 600 }}>+ Crear producto</Link></div>
          )}
        </div>
      )}
    </div>
  );
}
