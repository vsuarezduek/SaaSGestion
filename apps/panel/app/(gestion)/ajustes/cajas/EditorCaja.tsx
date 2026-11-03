'use client';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, tarjeta } from '../../../../lib/estilos.ts';
import { estadoCajaAccion, guardarCajaAccion, moverCajaAccion } from '../../cajas/acciones.ts';

export interface DatosCaja { id: string; nombre: string; tipo: string; impuesto: string; activa: boolean; abierta: boolean; saldo: string }

export default function EditorCaja({ caja, primera, ultima }: { caja: DatosCaja; primera: boolean; ultima: boolean }) {
  const [d, setD] = useState({ nombre: caja.nombre, tipo: caja.tipo, impuesto: caja.impuesto });
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pend, iniciar] = useTransition();
  const correr = (fn: () => Promise<{ error?: string }>, bien = false) => iniciar(async () => { setMsg(null); setOk(false); const r = await fn(); if (r.error) setMsg(r.error); else setOk(bien); });
  return (
    <div style={{ ...tarjeta, opacity: caja.activa ? 1 : 0.6 }}>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label="Nombre" value={d.nombre} maxLength={60} onChange={(e) => setD({ ...d, nombre: e.target.value })} style={{ ...campo, flex: '2 1 160px', marginTop: 0 }} />
        <select aria-label="Tipo" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })} style={{ ...campo, flex: '1 1 130px', marginTop: 0 }}>
          <option value="efectivo">Efectivo (arqueo)</option><option value="digital">Digital (conciliar)</option>
        </select>
        <input aria-label="Impuesto por transacción %" title="Impuesto por transacción (%)" value={d.impuesto} onChange={(e) => setD({ ...d, impuesto: e.target.value })} style={{ ...campo, flex: '0 1 80px', marginTop: 0 }} />
        <button type="button" style={boton} disabled={pend} onClick={() => correr(() => guardarCajaAccion(caja.id, { nombre: d.nombre, tipo: d.tipo, impuestoTransaccion: Number(d.impuesto.replace(',', '.') || '0') }), true)}>Guardar</button>
        {caja.activa && <>
          <button type="button" style={botonSecundario} disabled={pend || primera} title="Subir" onClick={() => correr(() => moverCajaAccion(caja.id, 'arriba'))}>↑</button>
          <button type="button" style={botonSecundario} disabled={pend || ultima} title="Bajar" onClick={() => correr(() => moverCajaAccion(caja.id, 'abajo'))}>↓</button>
        </>}
        <button type="button" style={botonSecundario} disabled={pend} onClick={() => correr(() => estadoCajaAccion(caja.id, !caja.activa))}>{caja.activa ? 'Archivar' : 'Reactivar'}</button>
      </div>
      <div style={{ fontSize: 12, color: '#5c6d66', marginTop: 6 }}>
        {caja.activa ? (caja.abierta ? 'Abierta' : 'Cerrada') : 'Archivada'} · saldo {caja.saldo}{ok ? ' · guardado' : ''}
      </div>
    </div>
  );
}
