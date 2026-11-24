'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { boton, campo, tarjeta } from '../../../lib/estilos.ts';
import type { ProveedorParaCompra } from '../../../lib/compras.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import ModalNuevoProveedor from '../ModalNuevoProveedor.tsx';
import { buscarProveedoresAccion } from './acciones.ts';

/** Igual que el prototipo: la nota de crédito de proveedor es un tipo de comprobante más. */
const TIPOS: [string, string][] = [['remito', 'Remito'], ['factura_a', 'Factura A'], ['factura_b', 'Factura B'], ['sin_comprobante', 'Sin comprobante'], ['nota_credito', 'Nota de crédito']];

/**
 * «Nueva compra» como en el prototipo: buscar el proveedor, elegir el comprobante y Continuar.
 * Si el proveedor no existe se crea ahí mismo en una ventana emergente. La cuenta corriente se elige dentro de la compra.
 */
export default function BuscadorNuevaCompra({ categorias }: { categorias: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('remito');
  const [res, setRes] = useState<ProveedorParaCompra[] | null>(null);
  const [proveedor, setProveedor] = useState<{ id: string; nombre: string; saldo: string } | null>(null); // null = todavía sin elegir
  const [modal, setModal] = useState<string | null>(null);
  const [yendo, iniciar] = useTransition();
  const turno = useRef(0);
  useEffect(() => {
    const mio = ++turno.current;
    if (q.trim() === '') { setRes(null); return; }
    const t = setTimeout(async () => {
      const r = await buscarProveedoresAccion(q);
      if (mio === turno.current) setRes(r);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const elegir = (c: { id: string; nombre: string; saldo: string }) => { setProveedor(c); setQ(''); setRes(null); };
  const continuar = () => iniciar(() => {
    const qs = new URLSearchParams();
    if (proveedor) qs.set('proveedor', proveedor.id);
    if (tipo === 'nota_credito') { router.push(`/compras/nota-de-credito/nueva?${qs}`); return; }
    qs.set('comprobante', tipo);
    router.push(`/compras/nueva?${qs}`);
  });
  const saldo = proveedor ? aCentavos(proveedor.saldo) : 0;

  return (
    <div style={tarjeta}>
      <b>Nueva compra</b>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor" style={{ ...campo, flex: '2 1 240px', marginTop: 0 }} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Comprobante" style={{ ...campo, flex: '1 1 150px', marginTop: 0 }}>
          {TIPOS.map(([v, t]) => (<option key={v} value={v}>{t}</option>))}
        </select>
      </div>
      {q.trim() !== '' && (
        <div style={{ marginTop: 6, maxHeight: 340, overflowY: 'auto' }}>
          {res === null && <div style={{ fontSize: 13, color: '#5c6d66' }}>Buscando…</div>}
          {res?.map((c) => (
            <button key={c.id} type="button" onClick={() => elegir(c)}
              style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, padding: '8px 4px', background: 'none', border: 0, borderBottom: '1px solid #d3e6de', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
              <span>{c.nombre}</span>
              {aCentavos(c.saldo) > 0 && <span style={{ color: '#b4571a', fontSize: 12 }}>le debemos {formatearPesos(aCentavos(c.saldo))}</span>}
            </button>
          ))}
          {res && res.length === 0 && (
            <button type="button" onClick={() => setModal(q)}
              style={{ width: '100%', padding: 8, marginTop: 4, background: '#f0f8f5', border: '1px dashed #1c9764', borderRadius: 8, cursor: 'pointer', color: '#1c9764', fontWeight: 600, font: 'inherit', textAlign: 'left' }}>
              + Crear proveedor «{q.trim()}»
            </button>
          )}
        </div>
      )}
      <p style={{ fontSize: 14, color: '#5c6d66', margin: '10px 0 4px' }}>Proveedor: <b style={{ color: '#1f2d27' }}>{proveedor?.nombre ?? 'sin elegir'}</b></p>
      {saldo !== 0 && <div style={{ fontSize: 13, color: saldo > 0 ? '#b4571a' : '#1b5f63', marginBottom: 6 }}>{saldo > 0 ? 'Saldo pendiente de pago' : 'Saldo a favor nuestro'}: {formatearPesos(Math.abs(saldo))}</div>}
      <button type="button" style={boton} disabled={yendo || (tipo === 'nota_credito' && !proveedor)} onClick={continuar}>{yendo ? 'Abriendo…' : 'Continuar'}</button>
      {tipo === 'nota_credito' && !proveedor && <span style={{ marginLeft: 8, fontSize: 13, color: '#5c6d66' }}>Elegí el proveedor al que le devolvés mercadería.</span>}
      {modal !== null && (
        <ModalNuevoProveedor
          nombreInicial={modal} categorias={categorias}
          onCerrar={() => setModal(null)}
          onCreado={(c) => { setModal(null); elegir({ id: c.id, nombre: c.nombre, saldo: '0' }); }}
        />
      )}
    </div>
  );
}
