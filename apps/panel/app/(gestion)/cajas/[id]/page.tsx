import { notFound } from 'next/navigation';
import { listarCajas, movimientosDeCaja, obtenerCaja, resumenDelTurno } from '../../../../lib/cajas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import DetalleCaja from './DetalleCaja.tsx';

export const dynamic = 'force-dynamic';

export default async function Caja({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ todos?: string }> }) {
  const { id } = await params;
  const { todos } = await searchParams;
  const s = await sesionObligatoria();
  const caja = await obtenerCaja(s, id);
  if (!caja) notFound();
  const [movs, resumen, otras] = await Promise.all([movimientosDeCaja(s, id, todos ? 200 : 10), resumenDelTurno(s, id), listarCajas(s)]);
  const $ = (n: string) => formatearPesos(aCentavos(n));
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{caja.abierta ? '🔓' : '🔒'} {caja.nombre}</h1>
      <DetalleCaja
        caja={{ id: caja.id, nombre: caja.nombre, tipo: caja.tipo, abierta: caja.abierta, saldo: $(caja.saldo), saldoCrudo: caja.saldo }}
        resumen={resumen ? { apertura: $(resumen.apertura), ingresos: $(resumen.ingresos), egresos: $(resumen.egresos), movimientos: resumen.movimientos } : null}
        otras={otras.filter((c) => c.id !== id).map((c) => ({ id: c.id, nombre: c.nombre, abierta: c.abierta }))}
        movimientos={movs.map((m) => ({ id: m.id, fecha: m.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, concepto: m.concepto ?? '', importe: $(m.importe), usuario: m.usuario ?? '', revertido: m.revertido }))}
        verTodos={Boolean(todos)}
      />
    </main>
  );
}
