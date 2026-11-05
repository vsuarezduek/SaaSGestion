import { listarCajas } from '../../../../../lib/cajas.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import { clienteParaVenta, listarMediosDePago } from '../../../../../lib/ventas.ts';
import NotaCreditoLibre from './NotaCreditoLibre.tsx';

export const dynamic = 'force-dynamic';

/** Nota de crédito sin venta de origen: se elige el cliente, los productos y el precio a mano. */
export default async function NotaDeCreditoLibre({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const q = await searchParams;
  const s = await sesionObligatoria();
  const [cliente, medios, cajas] = await Promise.all([q.cliente ? clienteParaVenta(s, q.cliente) : null, listarMediosDePago(s), listarCajas(s)]);
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nota de crédito sin venta de origen</h1>
      <NotaCreditoLibre
        clienteInicial={cliente}
        medios={medios.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, cajaIds: m.cajaIds }))}
        cajas={cajas.filter((c) => c.abierta).map((c) => ({ id: c.id, nombre: c.nombre }))}
      />
    </main>
  );
}
