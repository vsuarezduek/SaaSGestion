import { listarCajasParaAjustes } from '../../../../lib/cajas.ts';
import { exigir } from '../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { listarMediosDePago } from '../../../../lib/ventas.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import NuevaCaja from '../../cajas/NuevaCaja.tsx';
import Medios from '../medios/Medios.tsx';
import EditorCaja from './EditorCaja.tsx';

export const dynamic = 'force-dynamic';

export default async function AjustesCajas() {
  const s = await sesionObligatoria();
  exigir(s, 'ajustes');
  const [cajas, medios] = await Promise.all([listarCajasParaAjustes(s), listarMediosDePago(s)]);
  const activas = cajas.filter((c) => c.activa);
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Cajas y medios de pago</h1>
      <h2>Cajas</h2>
      <p style={{ color: '#5c6d66', fontSize: 14 }}>Efectivo se cuenta (arqueo); digital se concilia con la app o el banco. El impuesto por transacción se aplica a los pagos que salen de la caja. Una caja se archiva cuando está cerrada y sin saldo.</p>
      <NuevaCaja />
      {cajas.map((c) => (
        <EditorCaja key={c.id + c.nombre + c.tipo + c.impuestoTransaccion} caja={{ id: c.id, nombre: c.nombre, tipo: c.tipo, impuesto: String(c.impuestoTransaccion), activa: c.activa, abierta: c.abierta, saldo: formatearPesos(aCentavos(c.saldo)) }}
          primera={c.id === activas[0]?.id} ultima={c.id === activas[activas.length - 1]?.id} />
      ))}
      <h2>Medios de pago</h2>
      <p style={{ color: '#5c6d66', fontSize: 14 }}>Cada medio habilita solo ciertas cajas y puede llevar una comisión (porcentaje más el IVA que se le suma). La primera caja que tildes es la que se propone sola al cobrar.</p>
      <Medios cajas={activas.map((c) => ({ id: c.id, nombre: c.nombre }))} medios={medios.map((m) => ({ id: m.id, nombre: m.nombre, comision: String(m.comisionPct), iva: m.ivaComision, cajaIds: m.cajaIds }))} />
    </main>
  );
}
