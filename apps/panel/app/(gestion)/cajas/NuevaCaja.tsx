'use client';
import { useState, useTransition } from 'react';
import { boton, campo, error as estiloError, tarjeta } from '../../../lib/estilos.ts';
import { guardarCajaAccion } from './acciones.ts';

export default function NuevaCaja() {
  const [d, setD] = useState({ nombre: '', tipo: 'efectivo', impuesto: '0' });
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const crear = () =>
    iniciar(async () => {
      setMsg(null);
      const r = await guardarCajaAccion(null, { nombre: d.nombre, tipo: d.tipo, impuestoTransaccion: Number(d.impuesto.replace(',', '.') || '0') });
      if (r.error) setMsg(r.error); else setD({ nombre: '', tipo: 'efectivo', impuesto: '0' });
    });
  return (
    <div style={{ ...tarjeta, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {msg && <div style={{ ...estiloError, width: '100%' }}>{msg}</div>}
      <input placeholder="Nombre de la caja" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} style={{ ...campo, flex: '2 1 180px', marginTop: 0 }} />
      <select value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })} style={{ ...campo, flex: '1 1 120px', marginTop: 0 }}>
        <option value="efectivo">Efectivo (arqueo)</option><option value="digital">Digital (conciliar)</option>
      </select>
      <input title="Impuesto por transacción (%)" placeholder="Impuesto %" value={d.impuesto} onChange={(e) => setD({ ...d, impuesto: e.target.value })} style={{ ...campo, flex: '0 1 100px', marginTop: 0 }} />
      <button type="button" style={boton} disabled={pend} onClick={crear}>Agregar caja</button>
    </div>
  );
}
