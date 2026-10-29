'use client';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../lib/estilos.ts';
import { movimientoAccion, revertirAccion } from './personas.ts';

export interface Fila { id: string; fecha: string; tipo: string; importe: string; concepto: string; revertido: boolean; usuario: string }
const TIPOS: Record<string, string> = { saldo_inicial: 'Saldo inicial', ajuste: 'Ajuste', reversion: 'Reversión' };

export default function CuentaCorriente({ tipo, id, saldo, filas, puedeOperar }: { tipo: 'cliente' | 'proveedor'; id: string; saldo: string; filas: Fila[]; puedeOperar: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const [f, setF] = useState({ tipo: 'ajuste', importe: '', concepto: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const enviar = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await movimientoAccion(tipo, id, f);
      if (r.error) setMsg(r.error); else setF({ ...f, importe: '', concepto: '' });
    });
  const revertir = (m: string) =>
    iniciar(async () => {
      const r = await revertirAccion(tipo, id, m);
      if (r.error) setMsg(r.error);
    });
  return (
    <div style={tarjeta}>
      <button type="button" style={{ ...botonSecundario, width: '100%', textAlign: 'left' }} onClick={() => setAbierta(!abierta)}>
        {abierta ? '▾' : '▸'} Cuenta corriente · saldo {saldo}
      </button>
      {abierta && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, color: '#5c6d66' }}>
            Saldo positivo = {tipo === 'cliente' ? 'el cliente nos debe' : 'le debemos al proveedor'}; negativo = saldo a favor. Los movimientos no se editan: se corrigen con una reversión.
          </p>
          {msg && <div style={estiloError}>{msg}</div>}
          {puedeOperar && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
              <label style={{ ...etiqueta, flex: '1 1 140px', marginBottom: 0 }}>Tipo
                <select style={campo} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                  <option value="ajuste">Ajuste</option><option value="saldo_inicial">Saldo inicial</option>
                </select>
              </label>
              <label style={{ ...etiqueta, flex: '1 1 120px', marginBottom: 0 }}>Importe (− reduce)
                <input style={campo} inputMode="decimal" value={f.importe} onChange={(e) => setF({ ...f, importe: e.target.value })} />
              </label>
              <label style={{ ...etiqueta, flex: '2 1 200px', marginBottom: 0 }}>Concepto
                <input style={campo} value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} />
              </label>
              <button type="button" style={boton} disabled={pend} onClick={enviar}>Registrar</button>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={celda}>Fecha</th><th style={celda}>Tipo</th><th style={celda}>Concepto</th><th style={celda}>Importe</th><th style={celda}>Usuario</th><th style={celda}></th></tr></thead>
            <tbody>
              {filas.map((m) => (
                <tr key={m.id} style={{ opacity: m.revertido ? 0.5 : 1 }}>
                  <td style={celda}>{m.fecha}</td><td style={celda}>{TIPOS[m.tipo] ?? m.tipo}{m.revertido ? ' (revertido)' : ''}</td>
                  <td style={celda}>{m.concepto}</td><td style={celda}>{m.importe}</td><td style={celda}>{m.usuario}</td>
                  <td style={celda}>{puedeOperar && !m.revertido && m.tipo !== 'reversion' && (<button type="button" style={botonSecundario} disabled={pend} onClick={() => revertir(m.id)}>Revertir</button>)}</td>
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
