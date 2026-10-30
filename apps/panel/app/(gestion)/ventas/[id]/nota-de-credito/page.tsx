import Link from 'next/link';
import { listarCajas } from '../../../../../lib/cajas.ts';
import { aviso, tarjeta } from '../../../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import { datosParaNotaCredito, listarMediosDePago } from '../../../../../lib/ventas.ts';
import FormularioNotaCredito from './FormularioNotaCredito.tsx';

export const dynamic = 'force-dynamic';

export default async function NotaDeCredito({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [datos, medios, cajas] = await Promise.all([datosParaNotaCredito(s, id), listarMediosDePago(s), listarCajas(s)]);
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nota de crédito{datos ? ` · venta N° ${datos.venta.numero}` : ''}</h1>
      {!datos ? (
        <div style={tarjeta}>Esta venta no existe, está anulada o es una nota de crédito: no se puede devolver. <Link href="/ventas" style={{ color: '#1c9764' }}>Volver a Ventas</Link></div>
      ) : datos.renglones.every((r) => Number(r.disponible) <= 0) ? (
        <div style={aviso}>Ya se devolvió todo lo de esta venta. <Link href={`/ventas/${datos.venta.id}`} style={{ color: '#1b5f63', fontWeight: 600 }}>Volver a la venta</Link></div>
      ) : (
        <FormularioNotaCredito
          datos={datos}
          medios={medios.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, cajaIds: m.cajaIds }))}
          cajas={cajas.filter((c) => c.abierta).map((c) => ({ id: c.id, nombre: c.nombre }))}
        />
      )}
    </main>
  );
}
