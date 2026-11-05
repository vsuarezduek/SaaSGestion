import Link from 'next/link';
import { tarjeta } from '../../../../../lib/estilos.ts';
import { datosParaNotaCreditoCompra } from '../../../../../lib/notasCreditoCompra.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import NuevaNotaCreditoCompra from './NuevaNotaCreditoCompra.tsx';

export const dynamic = 'force-dynamic';

export default async function NuevaNotaDeCreditoCompra({ searchParams }: { searchParams: Promise<{ proveedor?: string; compra?: string }> }) {
  const q = await searchParams;
  const s = await sesionObligatoria();
  const datos = await datosParaNotaCreditoCompra(s, q.proveedor ?? null, q.compra ?? null);
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nota de crédito de proveedor</h1>
      {!datos ? (
        <div style={tarjeta}>Elegí un proveedor desde su ficha (o una compra cerrada) para devolverle mercadería. <Link href="/proveedores" style={{ color: '#1c9764' }}>Ir a Proveedores</Link></div>
      ) : (
        <NuevaNotaCreditoCompra datos={datos} />
      )}
    </main>
  );
}
