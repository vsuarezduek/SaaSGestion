'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { botonSecundario, campo, tarjeta } from '../../../lib/estilos.ts';
import type { MovimientoDeUsuario } from '../../../lib/cajas.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { Desplegable } from '../Orden.tsx';
import { movimientosUsuariosAccion } from './acciones.ts';

const PASO = 15;
const gris = { fontSize: 12, color: '#5c6d66' } as const;
const fecha = (d: Date) => new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const TIPOS: Record<string, string> = {
  ingreso: 'Ingreso', egreso: 'Egreso', transferencia_salida: 'Transferencia', transferencia_entrada: 'Transferencia', apertura_diferencia: 'Dif. apertura',
  cierre_diferencia: 'Dif. cierre', traspaso_salida: 'Traspaso', traspaso_entrada: 'Traspaso', reversion: 'Anulación', cobro_venta: 'Venta', comision_venta: 'Comisión',
  cobro_recibo: 'Recibo', comision_recibo: 'Comisión', devolucion_venta: 'Devolución', devolucion_pago: 'Devolución de pago', pago_compra: 'Compra',
  impuesto_compra: 'Impuesto', pago_orden: 'Orden de pago', impuesto_orden: 'Impuesto',
};

/**
 * «Movimientos de caja de los usuarios» (administración) o «Mis movimientos de caja» (los demás), como el prototipo:
 * desplegable, abierto de entrada, de a 15 con «Mostrar 15 más».
 */
export default function MovimientosUsuarios({ esAdmin, usuarios, inicial }: { esAdmin: boolean; usuarios: { id: string; nombre: string }[]; inicial: { filas: MovimientoDeUsuario[]; hayMas: boolean } }) {
  const [abierto, setAbierto] = useState(true);
  const [usuario, setUsuario] = useState('');
  const [limite, setLimite] = useState(PASO);
  const [datos, setDatos] = useState(inicial);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    if (usuario === '' && limite === PASO) { setDatos(inicial); return; }
    let vigente = true;
    setCargando(true);
    movimientosUsuariosAccion(usuario || null, limite).then((r) => { if (vigente) { setDatos(r); setCargando(false); } });
    return () => { vigente = false; };
  }, [usuario, limite, inicial]);

  return (
    <Desplegable titulo={esAdmin ? 'Movimientos de caja de los usuarios' : 'Mis movimientos de caja'} abierto={abierto} onCambiar={setAbierto} estilo={tarjeta}>
      {esAdmin && usuarios.length > 0 && (
        <label style={{ ...gris, display: 'block', marginBottom: 8 }}>Usuario
          <select value={usuario} onChange={(e) => { setUsuario(e.target.value); setLimite(PASO); }} style={{ ...campo, maxWidth: 260, display: 'block' }}>
            <option value="">Todos</option>
            {usuarios.map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
          </select>
        </label>
      )}
      {datos.filas.map((m) => {
        const importe = aCentavos(m.importe);
        const fila = (
          <>
            <span style={{ flex: 1 }}>
              {m.concepto || TIPOS[m.tipo] || m.tipo}{m.revertido ? ' (revertido)' : ''}
              <div style={gris}>{fecha(m.fecha)} · {m.caja}{esAdmin && m.usuario ? ` · ${m.usuario}` : ''} · {TIPOS[m.tipo] ?? m.tipo}</div>
            </span>
            {importe !== 0 && <b style={{ color: importe < 0 ? '#b4571a' : undefined }}>{formatearPesos(importe)}</b>}
          </>
        );
        const estilo = { display: 'flex', gap: 8, alignItems: 'center', padding: '7px 4px', borderBottom: '1px solid #d3e6de', fontSize: 14, color: 'inherit', textDecoration: 'none' } as const;
        return <Link key={m.id} href={m.origen ?? `/cajas/${m.cajaId}`} style={estilo}>{fila}</Link>;
      })}
      {datos.filas.length === 0 && <div style={gris}>{cargando ? 'Cargando…' : 'Sin movimientos'}</div>}
      {datos.hayMas && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" style={botonSecundario} disabled={cargando} onClick={() => setLimite((l) => l + PASO)}>{cargando ? 'Cargando…' : `Mostrar ${PASO} más`}</button>
          <button type="button" style={botonSecundario} disabled={cargando} onClick={() => setLimite(500)}>Mostrar todos</button>
        </div>
      )}
    </Desplegable>
  );
}
