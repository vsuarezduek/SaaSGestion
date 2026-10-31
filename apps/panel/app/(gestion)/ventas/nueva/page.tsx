import { listarCajas } from '../../../../lib/cajas.ts';
import { listasDePrecios } from '../../../../lib/catalogo.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { buscarClientesParaVenta, datosParaEditar, listarMediosDePago } from '../../../../lib/ventas.ts';
import { obtenerAbierta } from '../../../../lib/ventasAbiertas.ts';
import NuevaVenta from './NuevaVenta.tsx';

export const dynamic = 'force-dynamic';

export default async function Nueva({ searchParams }: { searchParams: Promise<{ abierta?: string; editar?: string }> }) {
  const { abierta: abiertaId, editar } = await searchParams;
  const s = await sesionObligatoria();
  const abierta = abiertaId ? await obtenerAbierta(s, abiertaId) : null;
  const edicion = editar ? await datosParaEditar(s, editar) : null;
  const [listas, medios, cajas, cf] = await Promise.all([listasDePrecios(s), listarMediosDePago(s), listarCajas(s), buscarClientesParaVenta(s, '')]);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{edicion ? `Editar venta N° ${edicion.numero}` : abierta ? (abierta.datos.pedido ? 'Pedido de cliente' : 'Venta abierta') : 'Nueva venta'}</h1>
      {editar && !edicion && <div style={{ background: '#fbeae0', color: '#b4571a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Esa venta no se puede editar: no existe, está anulada, es una nota de crédito o ya tiene notas de crédito (anulalas primero).</div>}
      {abiertaId && !abierta && <div style={{ background: '#fbeae0', color: '#b4571a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Esa venta abierta ya no está disponible (se cerró o se descartó). Podés cargar una nueva.</div>}
      <NuevaVenta
        key={edicion ? `editar-${editar}` : abierta?.id ?? 'nueva'}
        abierta={abierta}
        edicion={edicion ? { ventaId: editar!, numero: edicion.numero, datos: edicion.datos } : null}
        listas={listas}
        medios={medios.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, comisionPct: m.comisionPct, ivaComision: m.ivaComision, cajaIds: m.cajaIds }))}
        cajas={cajas.filter((c) => c.abierta).map((c) => ({ id: c.id, nombre: c.nombre }))}
        clienteInicial={edicion?.cliente ?? abierta?.cliente ?? cf.find((c) => c.esConsumidorFinal) ?? cf[0]!}
      />
    </main>
  );
}
