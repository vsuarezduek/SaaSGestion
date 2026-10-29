import { listarCajas } from '../../../../lib/cajas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { listarMediosDePago } from '../../../../lib/ventas.ts';
import Medios from './Medios.tsx';

export const dynamic = 'force-dynamic';

export default async function MediosDePago() {
  const s = await sesionObligatoria();
  const [medios, cajas] = await Promise.all([listarMediosDePago(s), listarCajas(s)]);
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Medios de pago</h1>
      <p style={{ color: '#5c6d66', fontSize: 14 }}>Cada medio habilita solo ciertas cajas y puede llevar una comisión (porcentaje más el IVA que se le suma).</p>
      <Medios cajas={cajas.map((c) => ({ id: c.id, nombre: c.nombre }))} medios={medios.map((m) => ({ id: m.id, nombre: m.nombre, comision: String(m.comisionPct), iva: m.ivaComision, cajaIds: m.cajaIds }))} />
    </main>
  );
}
