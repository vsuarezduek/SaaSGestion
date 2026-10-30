'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../../lib/estilos.ts';
import type { DatosParaNotaCredito } from '../../../../../lib/ventas.ts';
import { aCentavos, calcularVenta, formatearCantidad, formatearPesos, normalizarCantidad } from '../../../../../../../packages/dominio/src/index.ts';
import { emitirNotaCreditoAccion } from '../../acciones.ts';

interface Props {
  datos: DatosParaNotaCredito;
  medios: { id: string; nombre: string; cajaIds: string[] }[];
  cajas: { id: string; nombre: string }[];
}

const milesimas = (n: string) => Math.round(Number(n.replace(',', '.')) * 1000);

export default function FormularioNotaCredito({ datos, medios, cajas }: Props) {
  const router = useRouter();
  const [clave] = useState(() => crypto.randomUUID());   // la misma nota no se emite dos veces
  const [cant, setCant] = useState<Record<string, string>>(() => Object.fromEntries(datos.renglones.map((r) => [r.id, Number(r.disponible) > 0 ? r.disponible : '0'])));
  const [cobroTipo, setCobroTipo] = useState<'caja' | 'cuenta_corriente'>('caja');
  const [medioId, setMedioId] = useState('');
  const [cajaId, setCajaId] = useState('');
  const [nota, setNota] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const medio = medios.find((m) => m.id === medioId) ?? null;
  const cajasDelMedio = medio ? cajas.filter((c) => medio.cajaIds.includes(c.id)) : [];

  const elegidos = datos.renglones.filter((r) => milesimas(cant[r.id] || '0') > 0);
  const calculo = (() => {
    try {
      if (elegidos.length === 0) return null;
      // Igual que el servidor: si se devuelve todo lo vendido, se devuelve exactamente lo cobrado.
      const esTotal = !datos.conDevoluciones && elegidos.length === datos.renglones.length && elegidos.every((r) => milesimas(cant[r.id]!) === milesimas(r.cantidad));
      return calcularVenta(
        elegidos.map((r) => {
          const c = normalizarCantidad(cant[r.id]!);
          if (c === null) throw new Error('cantidad inválida');
          return { cantidad: c, precio: aCentavos(r.precio), descuentoPct: Number(r.descuentoPct), iva: Number(r.iva) };
        }),
        esTotal ? { totalFinal: aCentavos(datos.venta.total) } : Number(datos.venta.descuentoPct),
      );
    } catch { return null; }
  })();

  const excede = datos.renglones.some((r) => milesimas(cant[r.id] || '0') > milesimas(r.disponible));
  const emitir = () => iniciar(async () => {
    setMsg(null);
    const r = await emitirNotaCreditoAccion({
      clave, ventaOrigenId: datos.venta.id, fecha: '', nota,
      renglones: elegidos.map((x) => ({ renglonOrigenId: x.id, cantidad: cant[x.id] })),
      cobro: cobroTipo === 'cuenta_corriente' ? { tipo: 'cuenta_corriente' } : { tipo: 'caja', medioPagoId: medioId, cajaId },
    });
    if (r.error) setMsg(r.error); else router.push(`/ventas/${r.id}`);
  });

  const celda = { padding: '4px 6px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const $ = (c: number) => formatearPesos(c);
  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={tarjeta}>
        <div><b>Cliente:</b> {datos.venta.cliente}</div>
        <p style={{ fontSize: 13, color: '#5c6d66', marginBottom: 0 }}>Indicá cuánto devuelve de cada producto (0 = no lo devuelve). Los precios y descuentos son los de la venta original.</p>
      </div>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Producto</th><th style={celda}>Vendido</th><th style={celda}>Por devolver</th><th style={celda}>Precio</th><th style={celda}>Devuelve</th></tr></thead>
          <tbody>
            {datos.renglones.map((r) => (
              <tr key={r.id}>
                <td style={celda}>{r.descripcion}</td>
                <td style={celda}>{formatearCantidad(r.cantidad)}</td>
                <td style={celda}>{formatearCantidad(r.disponible)}</td>
                <td style={celda}>{$(aCentavos(r.precio))}{Number(r.descuentoPct) ? ` (−${r.descuentoPct}%)` : ''}</td>
                <td style={{ ...celda, width: 100 }}>
                  <input style={{ ...campo, marginTop: 0, padding: 6 }} inputMode="decimal" disabled={Number(r.disponible) <= 0} value={cant[r.id]} onChange={(e) => setCant((c) => ({ ...c, [r.id]: e.target.value }))} />
                  {milesimas(cant[r.id] || '0') > milesimas(r.disponible) && <div style={{ color: '#b4571a', fontSize: 12 }}>Máximo {formatearCantidad(r.disponible)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          {calculo && calculo.descuentoTotal > 0 && <div>Subtotal {$(calculo.subtotal)} · Descuento: −{$(calculo.descuentoTotal)}</div>}
          <div style={{ fontSize: 22 }}><b>Total a devolver {calculo ? $(calculo.total) : '—'}</b></div>
        </div>
      </div>
      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ ...etiqueta, flex: '1 1 200px', marginBottom: 0 }}>Cómo se devuelve
            <select style={campo} value={cobroTipo} onChange={(e) => setCobroTipo(e.target.value as 'caja' | 'cuenta_corriente')}>
              <option value="caja">Devolver el dinero desde una caja</option>
              {datos.cuentaCorriente && <option value="cuenta_corriente">Descontar de la cuenta corriente</option>}
            </select>
          </label>
          {cobroTipo === 'caja' && (
            <>
              <label style={{ ...etiqueta, flex: '1 1 160px', marginBottom: 0 }}>Medio de pago
                <select style={campo} value={medioId} onChange={(e) => { setMedioId(e.target.value); setCajaId(''); }}>
                  <option value="">Elegir…</option>{medios.map((m) => (<option key={m.id} value={m.id}>{m.nombre}</option>))}
                </select>
              </label>
              <label style={{ ...etiqueta, flex: '1 1 160px', marginBottom: 0 }}>Caja
                <select style={campo} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                  <option value="">Elegir…</option>{cajasDelMedio.map((c) => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
                </select>
              </label>
              {medio && cajasDelMedio.length === 0 && <span style={{ color: '#b4571a', fontSize: 13 }}>No hay cajas abiertas habilitadas para este medio.</span>}
            </>
          )}
          <label style={{ ...etiqueta, flex: '3 1 240px', marginBottom: 0 }}>Nota<input style={campo} value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" style={{ ...boton, fontSize: 16, padding: '12px 20px' }} disabled={pend || !calculo || excede || (cobroTipo === 'caja' && (!medioId || !cajaId))} onClick={emitir}>{pend ? 'Emitiendo…' : 'Emitir nota de crédito'}</button>{' '}
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => router.push(`/ventas/${datos.venta.id}`)}>Cancelar</button>
        </div>
      </div>
    </>
  );
}
