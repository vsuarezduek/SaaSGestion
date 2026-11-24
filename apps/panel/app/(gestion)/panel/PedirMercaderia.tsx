'use client';
// Mercadería a pedir agrupada por proveedor (cada proveedor se despliega): se tildan los productos y se arma la compra con esa selección.
// Como el prototipo, «+ Agregar» anota mercadería que no está en el catálogo (texto, cantidad y proveedor opcionales).
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError } from '../../../lib/estilos.ts';
import { agregarMercaderiaAccion, quitarMercaderiaAccion } from './acciones.ts';

export interface ItemPedir { id: string; nombre: string; stock: string | null; cantidad: string; unidad: string; marcado: boolean; manual?: boolean }
export interface GrupoPedir { proveedorId: string | null; proveedor: string; items: ItemPedir[] }

const gris = { fontSize: 12, color: '#5c6d66' } as const;

export default function PedirMercaderia({ grupos, proveedores }: { grupos: GrupoPedir[]; proveedores: { id: string; nombre: string }[] }) {
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const tildado = (id: string) => marcados[id] ?? true;
  const [form, setForm] = useState<{ abierto: boolean; descripcion: string; cantidad: string; proveedorId: string }>({ abierto: false, descripcion: '', cantidad: '', proveedorId: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const agregar = () => iniciar(async () => {
    setMsg(null);
    const r = await agregarMercaderiaAccion({ descripcion: form.descripcion, cantidad: form.cantidad, proveedorId: form.proveedorId || null });
    if (r.error) { setMsg(r.error); return; }
    setForm({ abierto: true, descripcion: '', cantidad: '', proveedorId: form.proveedorId });
  });
  const quitar = (id: string) => iniciar(async () => { setMsg(null); const r = await quitarMercaderiaAccion(id); if (r.error) setMsg(r.error); });
  return (
    <>
      {msg && <div style={{ ...estiloError, marginTop: 8 }}>{msg}</div>}
      {!form.abierto ? (
        <button type="button" style={{ ...botonSecundario, padding: '5px 10px', fontSize: 13, marginTop: 8 }} onClick={() => setForm({ ...form, abierto: true })}>+ Agregar</button>
      ) : (
        <div style={{ marginTop: 8, padding: 10, background: '#f0f8f5', borderRadius: 8 }}>
          <div style={gris}>¿No está en el catálogo? Anotalo como texto:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 4 }}>
            <input autoFocus aria-label="Producto" placeholder="Producto" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }} style={{ ...campo, marginTop: 0, flex: '3 1 200px' }} />
            <input aria-label="Cantidad" placeholder="Cantidad" inputMode="decimal" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} style={{ ...campo, marginTop: 0, flex: '1 1 90px' }} />
            <select aria-label="Proveedor" value={form.proveedorId} onChange={(e) => setForm({ ...form, proveedorId: e.target.value })} style={{ ...campo, marginTop: 0, flex: '2 1 160px' }}>
              <option value="">Sin proveedor</option>
              {proveedores.map((p) => (<option key={p.id} value={p.id}>{p.nombre}</option>))}
            </select>
            <button type="button" style={boton} disabled={pend || form.descripcion.trim() === ''} onClick={agregar}>{pend ? 'Agregando…' : 'Agregar'}</button>
            <button type="button" style={botonSecundario} disabled={pend} onClick={() => setForm({ ...form, abierto: false })}>Cerrar</button>
          </div>
          <div style={{ ...gris, marginTop: 4 }}>Para un producto del catálogo, usá «Marcar para pedir» en su ficha.</div>
        </div>
      )}
      {grupos.map((g) => {
        const ids = g.items.filter((i) => !i.manual && tildado(i.id)).map((i) => i.id);
        const manuales = g.items.filter((i) => i.manual && tildado(i.id)).map((i) => i.id);
        const n = ids.length + manuales.length;
        const url = `/compras/nueva?faltantes=1${g.proveedorId ? `&proveedor=${g.proveedorId}` : ''}&ids=${ids.join(',')}${manuales.length ? `&manuales=${manuales.join(',')}` : ''}`;
        return (
          <details key={g.proveedorId ?? 'sin'} style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>
                <b style={{ fontSize: 14 }}>▸ {g.proveedorId ? <Link href={`/proveedores/${g.proveedorId}`} style={{ color: 'inherit' }}>{g.proveedor}</Link> : g.proveedor}</b> <small style={gris}>({g.items.length})</small>
              </span>
              {n > 0 && <Link href={url} style={{ ...botonSecundario, textDecoration: 'none', padding: '4px 10px', fontSize: 13 }}>Armar compra ({n})</Link>}
            </summary>
            {g.items.map((i) => (
              <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 14 }}>
                <label style={{ display: 'flex', gap: 8, flex: 1 }}>
                  <input type="checkbox" checked={tildado(i.id)} onChange={(e) => setMarcados({ ...marcados, [i.id]: e.target.checked })} />
                  {i.manual
                    ? <span>{i.nombre}{i.cantidad ? ` · cantidad ${i.cantidad}` : ''} <small style={gris}>· fuera del catálogo</small></span>
                    : <span><Link href={`/productos/${i.id}`} style={{ color: 'inherit' }}>{i.nombre}</Link> · hay {i.stock}, pedir {i.cantidad} {i.unidad}{i.marcado ? ' · marcado' : ''}</span>}
                </label>
                {i.manual && <button type="button" aria-label={`Quitar ${i.nombre}`} disabled={pend} onClick={() => quitar(i.id)} style={{ background: 'none', border: '1px solid #d3e6de', borderRadius: 6, cursor: 'pointer', color: '#b4571a', padding: '0 8px' }}>×</button>}
              </div>
            ))}
          </details>
        );
      })}
    </>
  );
}
