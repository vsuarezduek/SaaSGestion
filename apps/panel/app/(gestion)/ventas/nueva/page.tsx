import { listarCajas } from '../../../../lib/cajas.ts';
import { listasDePrecios } from '../../../../lib/catalogo.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { buscarClientesParaVenta, listarMediosDePago } from '../../../../lib/ventas.ts';
import NuevaVenta from './NuevaVenta.tsx';

export const dynamic = 'force-dynamic';

export default async function Nueva() {
  const s = await sesionObligatoria();
  const [listas, medios, cajas, cf] = await Promise.all([listasDePrecios(s), listarMediosDePago(s), listarCajas(s), buscarClientesParaVenta(s, '')]);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nueva venta</h1>
      <NuevaVenta
        listas={listas}
        medios={medios.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, comisionPct: m.comisionPct, ivaComision: m.ivaComision, cajaIds: m.cajaIds }))}
        cajas={cajas.filter((c) => c.abierta).map((c) => ({ id: c.id, nombre: c.nombre }))}
        clienteInicial={cf.find((c) => c.esConsumidorFinal) ?? cf[0]!}
      />
    </main>
  );
}
