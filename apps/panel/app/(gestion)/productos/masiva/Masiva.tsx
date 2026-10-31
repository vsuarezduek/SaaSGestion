'use client';
import { useState, useTransition } from 'react';
import { formatearPesos, aCentavos } from '../../../../../../packages/dominio/src/index.ts';
import type { EntradaMasiva, ResultadoMasiva } from '../../../../lib/masiva.ts';
import { aviso, boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { masivaAccion } from '../acciones.ts';

interface Props {
  listas: { id: string; nombre: string }[];
  rubros: { id: string; ruta: string }[];
  proveedores: { id: string; nombre: string }[];
}

export default function Masiva({ listas, rubros, proveedores }: Props) {
  const [proveedorId, setProveedorId] = useState('');
  const [rubroId, setRubroId] = useState('');
  const [listaIds, setListaIds] = useState<string[]>(listas.map((l) => l.id));
  const [modo, setModo] = useState<EntradaMasiva['modo']>('mantener_utilidad');
  const [tipo, setTipo] = useState<EntradaMasiva['tipo']>('pct');
  const [valor, setValor] = useState('');
  const [res, setRes] = useState<ResultadoMasiva | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();

  const entrada = (): EntradaMasiva => ({ proveedorId: proveedorId || null, rubroId: rubroId || null, listaIds: modo === 'mantener_utilidad' ? listaIds : null, modo, tipo, valor });
  const correr = (simular: boolean) =>
    iniciar(async () => {
      setMsg(null);
      const r = await masivaAccion(entrada(), simular);
      if (r.error) { setMsg(r.error); if (simular) setRes(null); return; }
      setRes(r.resultado ?? null);
    });
  const plata = (t: string) => formatearPesos(aCentavos(t));

  return (
    <div style={tarjeta}>
      {msg && <div style={estiloError}>{msg}</div>}
      {res?.aplicado && <div style={aviso}>Listo: se actualizaron {res.cambian} productos.</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...etiqueta, flex: '1 1 220px' }}>Proveedor
          <select style={campo} value={proveedorId} onChange={(e) => { setProveedorId(e.target.value); setRes(null); }}>
            <option value="">Todos</option>
            {proveedores.map((p) => (<option key={p.id} value={p.id}>{p.nombre}</option>))}
          </select>
        </label>
        <label style={{ ...etiqueta, flex: '1 1 220px' }}>Rubro (incluye subrubros)
          <select style={campo} value={rubroId} onChange={(e) => { setRubroId(e.target.value); setRes(null); }}>
            <option value="">Todos</option>
            {rubros.map((r) => (<option key={r.id} value={r.id}>{r.ruta}</option>))}
          </select>
        </label>
      </div>
      <label style={etiqueta}>Qué pasa con el precio
        <select style={campo} value={modo} onChange={(e) => { setModo(e.target.value as EntradaMasiva['modo']); setRes(null); }}>
          <option value="mantener_utilidad">Cambia el costo y el precio (mantengo la utilidad)</option>
          <option value="mantener_precio">Cambia solo el costo (el precio queda igual y cambia la utilidad)</option>
        </select>
      </label>
      {modo === 'mantener_utilidad' && (
        <div style={{ marginBottom: 10, fontSize: 14 }}>
          <b style={{ fontSize: 12, color: '#5c6d66' }}>Listas de precios a actualizar</b><br />
          {listas.map((l) => (
            <label key={l.id} style={{ marginRight: 14 }}>
              <input type="checkbox" checked={listaIds.includes(l.id)} onChange={(e) => { setListaIds(e.target.checked ? [...listaIds, l.id] : listaIds.filter((x) => x !== l.id)); setRes(null); }} /> {l.nombre}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...etiqueta, flex: '1 1 180px' }}>Tipo de valor
          <select style={campo} value={tipo} onChange={(e) => { setTipo(e.target.value as EntradaMasiva['tipo']); setRes(null); }}>
            <option value="pct">Porcentaje (%)</option>
            <option value="imp">Importe ($)</option>
          </select>
        </label>
        <label style={{ ...etiqueta, flex: '1 1 180px' }}>Valor (negativo para bajar)
          <input style={campo} inputMode="decimal" value={valor} onChange={(e) => { setValor(e.target.value); setRes(null); }} placeholder={tipo === 'pct' ? 'Ej.: 10 o -5' : 'Ej.: 250 o -100'} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" style={botonSecundario} disabled={pend} onClick={() => correr(true)}>{pend ? 'Calculando…' : 'Ver qué cambiaría'}</button>
        {res && !res.aplicado && res.cambian > 0 && (
          <button type="button" style={boton} disabled={pend} onClick={() => { if (window.confirm(`Se van a modificar ${res.cambian} productos. ¿Aplicar?`)) correr(false); }}>Aplicar a {res.cambian} productos</button>
        )}
      </div>
      {res && !res.aplicado && (
        <div style={{ marginTop: 14 }}>
          <p>Coinciden <b>{res.coinciden}</b> productos; el costo cambia en <b>{res.cambian}</b>.</p>
          {res.muestra.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Producto</th><th style={{ textAlign: 'left' }}>Costo</th><th style={{ textAlign: 'left' }}>Precios</th></tr></thead>
              <tbody>
                {res.muestra.map((m) => (
                  <tr key={m.id}>
                    <td>{m.nombre}</td>
                    <td>{plata(m.costoAntes)} → <b>{plata(m.costoDespues)}</b></td>
                    <td>{m.precios.map((p) => `${p.lista}: ${plata(p.antes)} → ${plata(p.despues)}`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {res.cambian > res.muestra.length && <p style={{ color: '#5c6d66', fontSize: 13 }}>Se muestran los primeros {res.muestra.length}.</p>}
        </div>
      )}
    </div>
  );
}
