import { obtenerCostosFijos } from '../../../../lib/costosFijos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import CostosFijos from './CostosFijos.tsx';

export const dynamic = 'force-dynamic';

export default async function PaginaCostosFijos() {
  const s = await sesionObligatoria();
  const cf = await obtenerCostosFijos(s);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Costos fijos</h1>
      <p style={{ color: '#5c6d66' }}>Suma estos costos fijos (alquiler, luz, agua, personal…) al costo de los productos elaborados, en proporción a lo que se produce de cada uno según las elaboraciones registradas. Sin elaboraciones en el período, el costo fijo es cero.</p>
      <CostosFijos cf={cf} />
    </main>
  );
}
