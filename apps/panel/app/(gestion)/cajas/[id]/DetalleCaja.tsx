'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { abrirCajaAccion, anularAccion, cerrarCajaAccion, movimientoCajaAccion, transferirAccion } from '../acciones.ts';

interface Props {
  caja: { id: string; nombre: string; tipo: string; abierta: boolean; saldo: string; saldoCrudo: string };
  resumen: { apertura: string; ingresos: string; egresos: string; movimientos: number } | null;
  otras: { id: string; nombre: string; abierta: boolean }[];
  movimientos: { id: string; fecha: string; tipo: string; concepto: string; importe: string; usuario: string; revertido: boolean }[];
  verTodos: boolean;
}
const TIPOS: Record<string, string> = {
  ingreso: 'Ingreso', egreso: 'Egreso', transferencia_salida: 'Transferencia', transferencia_entrada: 'Transferencia', apertura_diferencia: 'Dif. apertura',
  cierre_diferencia: 'Dif. cierre', traspaso_salida: 'Traspaso', traspaso_entrada: 'Traspaso', reversion: 'Anulación',
};

export default function DetalleCaja({ caja, resumen, otras, movimientos, verTodos }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const [apertura, setApertura] = useState('');
  const [mov, setMov] = useState({ tipo: 'ingreso', importe: '', concepto: '', fecha: '' });
  const [tr, setTr] = useState({ destinoId: '', importe: '', concepto: '' });
  const [cierre, setCierre] = useState({ contado: '', cambioDejado: '', destinoId: '' });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const correr = (fn: () => Promise<{ error?: string }>, alTerminar?: () => void) =>
    iniciar(async () => {
      setMsg(null);
      const r = await fn();
      if (r.error) setMsg(r.error); else alTerminar?.();
    });
  const fila = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'end' };
  const cel = (flex: string) => ({ ...etiqueta, flex, marginBottom: 0 });

  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={tarjeta}>
        <b style={{ fontSize: 22 }}>{caja.saldo}</b> <span style={{ color: '#5c6d66' }}>saldo · {caja.tipo === 'digital' ? 'digital' : 'efectivo'} · {caja.abierta ? 'abierta' : 'cerrada'}</span>
        {resumen && (
          <p style={{ fontSize: 13, color: '#5c6d66', marginBottom: 0 }}>
            Turno: apertura {resumen.apertura} · ingresos {resumen.ingresos} · egresos {resumen.egresos} · {resumen.movimientos} movimientos
          </p>
        )}
      </div>

      {!caja.abierta ? (
        <div style={tarjeta}>
          <b>Abrir caja</b>
          <p style={{ fontSize: 13, color: '#5c6d66' }}>{caja.tipo === 'digital' ? 'Cargá el saldo según la app o el banco.' : 'Contá el efectivo.'} Si no coincide con {caja.saldo}, la diferencia queda registrada.</p>
          <div style={fila}>
            <label style={cel('1 1 160px')}>{caja.tipo === 'digital' ? 'Saldo real' : 'Efectivo contado'}<input style={campo} inputMode="decimal" value={apertura} onChange={(e) => setApertura(e.target.value)} /></label>
            <button type="button" style={boton} disabled={pend} onClick={() => correr(() => abrirCajaAccion(caja.id, { contado: apertura }), () => setApertura(''))}>Abrir</button>
          </div>
        </div>
      ) : (
        <>
          <div style={tarjeta}>
            <b>Movimiento manual</b>
            <div style={{ ...fila, marginTop: 8 }}>
              <label style={cel('0 1 120px')}>Tipo<select style={campo} value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value })}><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></label>
              <label style={cel('1 1 110px')}>Importe<input style={campo} inputMode="decimal" value={mov.importe} onChange={(e) => setMov({ ...mov, importe: e.target.value })} /></label>
              <label style={cel('2 1 180px')}>Concepto<input style={campo} value={mov.concepto} onChange={(e) => setMov({ ...mov, concepto: e.target.value })} /></label>
              <label style={cel('1 1 180px')}>Fecha y hora (opcional)<input style={campo} type="datetime-local" value={mov.fecha} onChange={(e) => setMov({ ...mov, fecha: e.target.value })} /></label>
              <button type="button" style={boton} disabled={pend} onClick={() => correr(() => movimientoCajaAccion(caja.id, mov), () => setMov({ ...mov, importe: '', concepto: '' }))}>Registrar</button>
            </div>
          </div>
          <div style={tarjeta}>
            <b>Transferir a otra caja</b>
            <div style={{ ...fila, marginTop: 8 }}>
              <label style={cel('1 1 160px')}>Destino
                <select style={campo} value={tr.destinoId} onChange={(e) => setTr({ ...tr, destinoId: e.target.value })}>
                  <option value="">Elegir…</option>{otras.filter((o) => o.abierta).map((o) => (<option key={o.id} value={o.id}>{o.nombre}</option>))}
                </select>
              </label>
              <label style={cel('1 1 110px')}>Importe (vacío = todo)<input style={campo} inputMode="decimal" value={tr.importe} onChange={(e) => setTr({ ...tr, importe: e.target.value })} /></label>
              <label style={cel('2 1 160px')}>Concepto<input style={campo} value={tr.concepto} onChange={(e) => setTr({ ...tr, concepto: e.target.value })} /></label>
              <button type="button" style={boton} disabled={pend} onClick={() => correr(() => transferirAccion({ origenId: caja.id, destinoId: tr.destinoId, importe: tr.importe.trim() === '' ? null : tr.importe, concepto: tr.concepto }), () => setTr({ ...tr, importe: '', concepto: '' }))}>Transferir</button>
            </div>
          </div>
          <div style={tarjeta}>
            <b>Cerrar caja (arqueo)</b>
            <p style={{ fontSize: 13, color: '#5c6d66' }}>Esperado: {caja.saldo}. Si lo contado difiere, el sobrante o faltante queda registrado. Lo que no dejes de cambio se traspasa a la caja elegida.</p>
            <div style={fila}>
              <label style={cel('1 1 130px')}>{caja.tipo === 'digital' ? 'Saldo real' : 'Contado'}<input style={campo} inputMode="decimal" value={cierre.contado} onChange={(e) => setCierre({ ...cierre, contado: e.target.value })} /></label>
              <label style={cel('1 1 130px')}>Dejar de cambio<input style={campo} inputMode="decimal" value={cierre.cambioDejado} onChange={(e) => setCierre({ ...cierre, cambioDejado: e.target.value })} /></label>
              <label style={cel('1 1 160px')}>Traspasar el resto a
                <select style={campo} value={cierre.destinoId} onChange={(e) => setCierre({ ...cierre, destinoId: e.target.value })}>
                  <option value="">No traspasar</option>{otras.filter((o) => o.abierta).map((o) => (<option key={o.id} value={o.id}>{o.nombre}</option>))}
                </select>
              </label>
              <button type="button" style={boton} disabled={pend} onClick={() => {
                if (window.confirm('¿Cerrar la caja? Quedará bloqueada hasta abrirla de nuevo.')) correr(() => cerrarCajaAccion(caja.id, { contado: cierre.contado, cambioDejado: cierre.cambioDejado, destinoId: cierre.destinoId || null }), () => setCierre({ contado: '', cambioDejado: '', destinoId: '' }));
              }}>Cerrar caja</button>
            </div>
          </div>
        </>
      )}

      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <b>Movimientos</b>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Fecha</th><th style={celda}>Tipo</th><th style={celda}>Concepto</th><th style={celda}>Importe</th><th style={celda}>Usuario</th><th style={celda}></th></tr></thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} style={{ opacity: m.revertido ? 0.5 : 1 }}>
                <td style={celda}>{m.fecha}</td><td style={celda}>{TIPOS[m.tipo] ?? m.tipo}{m.revertido ? ' (anulado)' : ''}</td><td style={celda}>{m.concepto}</td>
                <td style={celda}>{m.importe}</td><td style={celda}>{m.usuario}</td>
                <td style={celda}>{!m.revertido && m.tipo !== 'reversion' && (<button type="button" style={botonSecundario} disabled={pend} onClick={() => correr(() => anularAccion(caja.id, m.id))}>Anular</button>)}</td>
              </tr>
            ))}
            {movimientos.length === 0 && (<tr><td style={celda} colSpan={6}>Sin movimientos.</td></tr>)}
          </tbody>
        </table>
        {!verTodos && movimientos.length >= 10 && (<Link href={`/cajas/${caja.id}?todos=1`} style={{ color: '#1c9764' }}>Mostrar todos</Link>)}
      </div>
    </>
  );
}
