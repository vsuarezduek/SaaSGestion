'use client';
import { useState, useTransition } from 'react';
import { estadoStock, formatearCantidad } from '../../../../../packages/dominio/src/index.ts';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../lib/estilos.ts';
import { movimientoStockAccion, revertirStockAccion } from './acciones.ts';

export interface FilaStock { id: string; fecha: string; tipo: string; cantidad: string; concepto: string; revertido: boolean; usuario: string }
const TIPOS: Record<string, string> = { saldo_inicial: 'Stock inicial', ajuste: 'Ajuste', reversion: 'Reversión' };

export default function StockProducto({ productoId, stock, minimo, unidad, filas }: { productoId: string; stock: string; minimo: string; unidad: string; filas: FilaStock[] }) {
  const [abierta, setAbierta] = useState(false);
  const [f, setF] = useState({ tipo: 'ajuste', cantidad: '', concepto: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const estado = estadoStock(stock, minimo);
  const aviso = estado === 'negativo' ? { t: 'Stock negativo: revisá las ventas o cargá un ajuste.', c: '#b4571a', bg: '#fbeae0' }
    : estado === 'bajo_minimo' ? { t: 'Por debajo del stock mínimo: conviene reponer.', c: '#8a6d00', bg: '#fff4cc' } : null;
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const enviar = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await movimientoStockAccion(productoId, f);
      if (r.error) setMsg(r.error); else setF({ ...f, cantidad: '', concepto: '' });
    });
  const revertir = (m: string) =>
    iniciar(async () => {
      const r = await revertirStockAccion(productoId, m);
      if (r.error) setMsg(r.error);
    });
  return (
    <div style={{ ...tarjeta, maxWidth: 720 }}>
      {aviso && <div style={{ background: aviso.bg, color: aviso.c, borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>{aviso.t}</div>}
      <button type="button" style={{ ...botonSecundario, width: '100%', textAlign: 'left' }} onClick={() => setAbierta(!abierta)}>
        {abierta ? '▾' : '▸'} Stock actual: {formatearCantidad(stock)} {unidad}
      </button>
      {abierta && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, color: '#5c6d66' }}>Los movimientos no se editan: se corrigen con una reversión. Cantidad positiva entra, negativa sale.</p>
          {msg && <div style={estiloError}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
            <label style={{ ...etiqueta, flex: '1 1 130px', marginBottom: 0 }}>Tipo
              <select style={campo} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                <option value="ajuste">Ajuste</option><option value="saldo_inicial">Stock inicial</option>
              </select>
            </label>
            <label style={{ ...etiqueta, flex: '1 1 110px', marginBottom: 0 }}>Cantidad (− sale)
              <input style={campo} inputMode="decimal" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} />
            </label>
            <label style={{ ...etiqueta, flex: '2 1 180px', marginBottom: 0 }}>Concepto
              <input style={campo} value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} />
            </label>
            <button type="button" style={boton} disabled={pend} onClick={enviar}>Registrar</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={celda}>Fecha</th><th style={celda}>Tipo</th><th style={celda}>Concepto</th><th style={celda}>Cantidad</th><th style={celda}>Usuario</th><th style={celda}></th></tr></thead>
            <tbody>
              {filas.map((m) => (
                <tr key={m.id} style={{ opacity: m.revertido ? 0.5 : 1 }}>
                  <td style={celda}>{m.fecha}</td><td style={celda}>{TIPOS[m.tipo] ?? m.tipo}{m.revertido ? ' (revertido)' : ''}</td>
                  <td style={celda}>{m.concepto}</td><td style={celda}>{formatearCantidad(m.cantidad)}</td><td style={celda}>{m.usuario}</td>
                  <td style={celda}>{!m.revertido && m.tipo !== 'reversion' && (<button type="button" style={botonSecundario} disabled={pend} onClick={() => revertir(m.id)}>Revertir</button>)}</td>
                </tr>
              ))}
              {filas.length === 0 && (<tr><td style={celda} colSpan={6}>Sin movimientos.</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
