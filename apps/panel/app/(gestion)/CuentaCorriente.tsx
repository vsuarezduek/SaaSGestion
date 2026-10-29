'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../lib/estilos.ts';
import { movimientoAccion, revertirAccion } from './personas.ts';
import { registrarReciboAccion } from './recibos/acciones.ts';

export interface Fila {
  id: string; fecha: string; tipo: string; importe: string; importeCrudo: string; concepto: string; revertido: boolean; usuario: string;
  saldo: string; ventaId: string | null; reciboId: string | null;
}
export interface MedioCobro { id: string; nombre: string; cajas: { id: string; nombre: string }[] }
const TIPOS: Record<string, string> = { saldo_inicial: 'Saldo inicial', ajuste: 'Ajuste', reversion: 'Reversión', venta: 'Venta', recibo: 'Recibo' };

interface Props {
  tipo: 'cliente' | 'proveedor'; id: string; saldo: string; filas: Fila[]; puedeOperar: boolean;
  /** Solo clientes: medios de cobro para registrar recibos de pago. */
  medios?: MedioCobro[];
}

export default function CuentaCorriente({ tipo, id, saldo, filas, puedeOperar, medios }: Props) {
  const [abierta, setAbierta] = useState(false);
  const [f, setF] = useState({ tipo: 'ajuste', importe: '', concepto: '' });
  const [rec, setRec] = useState({ abierto: false, importe: '', medioId: medios?.[0]?.id ?? '', cajaId: medios?.[0]?.cajas[0]?.id ?? '', nota: '', ventaId: null as string | null });
  const [clave, setClave] = useState(() => crypto.randomUUID());
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
  const medio = medios?.find((m) => m.id === rec.medioId);
  const cambiarMedio = (medioId: string) => setRec({ ...rec, medioId, cajaId: medios?.find((m) => m.id === medioId)?.cajas[0]?.id ?? '' });
  const abrirRecibo = (fila?: Fila) => {
    setAbierta(true);
    setRec({ ...rec, abierto: true, importe: fila ? fila.importeCrudo : '', nota: fila ? `Recibo s/ ${fila.concepto}` : '', ventaId: fila?.ventaId ?? null });
  };
  const cobrar = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await registrarReciboAccion({ clave, clienteId: id, ventaId: rec.ventaId, importe: rec.importe, medioPagoId: rec.medioId, cajaId: rec.cajaId, nota: rec.nota });
      if (r.error) { setMsg(r.error); return; }
      setClave(crypto.randomUUID());
      setRec({ ...rec, abierto: false, importe: '', nota: '', ventaId: null });
    });
  const conRecibos = tipo === 'cliente' && puedeOperar && !!medios && medios.length > 0;
  return (
    <div style={tarjeta}>
      <button type="button" style={{ ...botonSecundario, width: '100%', textAlign: 'left' }} onClick={() => setAbierta(!abierta)}>
        {abierta ? '▾' : '▸'} Cuenta corriente · saldo {saldo}
      </button>
      {tipo === 'cliente' && puedeOperar && medios && medios.length === 0 && <p style={{ fontSize: 12, color: '#5c6d66' }}>Para registrar un recibo hace falta una caja abierta con un medio de pago habilitado.</p>}
      {conRecibos && !rec.abierto && <div style={{ marginTop: 8 }}><button type="button" style={boton} onClick={() => abrirRecibo()}>+ Agregar recibo de pago</button></div>}
      {conRecibos && rec.abierto && (
        <div style={{ marginTop: 10, padding: 12, background: '#f0f8f5', borderRadius: 8 }}>
          <b>Recibo de pago</b>
          {msg && <div style={estiloError}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ ...etiqueta, flex: '1 1 120px', marginBottom: 0 }}>Importe
              <input style={campo} inputMode="decimal" value={rec.importe} onChange={(e) => setRec({ ...rec, importe: e.target.value })} />
            </label>
            <label style={{ ...etiqueta, flex: '1 1 140px', marginBottom: 0 }}>Medio de pago
              <select style={campo} value={rec.medioId} onChange={(e) => cambiarMedio(e.target.value)}>
                {medios!.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </label>
            <label style={{ ...etiqueta, flex: '1 1 140px', marginBottom: 0 }}>Caja
              <select style={campo} value={rec.cajaId} onChange={(e) => setRec({ ...rec, cajaId: e.target.value })}>
                {(medio?.cajas ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label style={{ ...etiqueta, flex: '2 1 200px', marginBottom: 0 }}>Comentario
              <input style={campo} value={rec.nota} onChange={(e) => setRec({ ...rec, nota: e.target.value })} />
            </label>
          </div>
          <p style={{ fontSize: 12, color: '#5c6d66' }}>Se suma a la caja elegida y baja el saldo del cliente. Puede ser un pago parcial.</p>
          <button type="button" style={boton} disabled={pend} onClick={cobrar}>{pend ? 'Registrando…' : 'Registrar recibo'}</button>{' '}
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => setRec({ ...rec, abierto: false })}>Cancelar</button>
        </div>
      )}
      {abierta && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, color: '#5c6d66' }}>
            Saldo positivo = {tipo === 'cliente' ? 'el cliente nos debe' : 'le debemos al proveedor'}; negativo = saldo a favor. Los movimientos no se editan: se corrigen con una reversión. La columna «Saldo» es lo que quedó después de cada movimiento.
          </p>
          {msg && !rec.abierto && <div style={estiloError}>{msg}</div>}
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={celda}>Fecha</th><th style={celda}>Tipo</th><th style={celda}>Concepto</th><th style={celda}>Importe</th><th style={celda}>Saldo</th><th style={celda}>Usuario</th><th style={celda}></th></tr></thead>
              <tbody>
                {filas.map((m) => (
                  <tr key={m.id} style={{ opacity: m.revertido ? 0.5 : 1 }}>
                    <td style={celda}>{m.fecha}</td><td style={celda}>{TIPOS[m.tipo] ?? m.tipo}{m.revertido ? ' (revertido)' : ''}</td>
                    <td style={celda}>{m.concepto}</td><td style={celda}>{m.importe}</td><td style={{ ...celda, fontWeight: 600 }}>{m.saldo}</td><td style={celda}>{m.usuario}</td>
                    <td style={celda}>
                      {m.ventaId && <Link href={`/ventas/${m.ventaId}`} style={{ color: '#1c9764', marginRight: 8 }}>Ver venta</Link>}
                      {m.reciboId && <Link href={`/recibos/${m.reciboId}`} style={{ color: '#1c9764', marginRight: 8 }}>Ver recibo</Link>}
                      {conRecibos && m.tipo === 'venta' && !m.revertido && (<button type="button" style={botonSecundario} disabled={pend} onClick={() => abrirRecibo(m)}>Agregar recibo de pago</button>)}
                      {puedeOperar && !m.revertido && !['reversion', 'venta', 'recibo'].includes(m.tipo) && (<button type="button" style={botonSecundario} disabled={pend} onClick={() => revertir(m.id)}>Revertir</button>)}
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && (<tr><td style={celda} colSpan={7}>Sin movimientos.</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
