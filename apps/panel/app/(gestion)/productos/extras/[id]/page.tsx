import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detalleDatoExtra } from '../../../../../lib/extras.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import ValoresExtra from './ValoresExtra.tsx';

export const dynamic = 'force-dynamic';

export default async function DetalleDatoExtra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const d = await detalleDatoExtra(s, id);
  if (!d) notFound();
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <p><Link href="/productos/extras">← Datos extras</Link></p>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{d.nombre}</h1>
      <p style={{ color: '#5c6d66' }}>Tocá un valor para ver sus productos. «Quitar» le saca el valor al producto, pero no borra el producto. {d.sinValor} productos no tienen valor.</p>
      <ValoresExtra datoId={d.id} valores={d.valores} />
    </main>
  );
}
