import { listarCajas } from '../../../../lib/cajas.ts';
import { listasDePrecios } from '../../../../lib/catalogo.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { buscarClientesParaVenta, listarMediosDePago } from '../../../../lib/ventas.ts';
import { obtenerAbierta } from '../../../../lib/ventasAbiertas.ts';
import NuevaVenta from './NuevaVenta.tsx';

export const dynamic = 'force-dynamic';

export default async function Nueva({ searchParams }: { searchParams: Promise<{ abierta?: string }> }) {
  const { abierta: abiertaId } = await searchParams;
  const s = await sesionObligatoria();
  const abierta = abiertaId ? await obtenerAbierta(s, abiertaId) : null;
  const [listas, medios, cajas, cf] = await Promise.all([listasDePrecios(s), listarMediosDePago(s), listarCajas(s), buscarClientesParaVenta(s, '')]);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{abierta ? (abierta.datos.pedido ? 'Pedido de cliente' : 'Venta abierta') : 'Nueva venta'}</h1>
      {abiertaId && !abierta && <div style={{ background: '#fbeae0', color: '#b4571a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Esa venta abierta ya no está disponible (se cerró o se descartó). Podés cargar una nueva.</div>}
      <NuevaVenta
        key={abierta?.id ?? 'nueva'}
        abierta={abierta}
        listas={listas}
        medios={medios.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, comisionPct: m.comisionPct, ivaComision: m.ivaComision, cajaIds: m.cajaIds }))}
        cajas={cajas.filter((c) => c.abierta).map((c) => ({ id: c.id, nombre: c.nombre }))}
        clienteInicial={abierta?.cliente ?? cf.find((c) => c.esConsumidorFinal) ?? cf[0]!}
      />
    </main>
  );
}
