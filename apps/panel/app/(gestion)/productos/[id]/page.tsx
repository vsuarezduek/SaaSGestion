import { notFound } from 'next/navigation';
import { listarRubros, listasDePrecios, obtenerProducto } from '../../../../lib/catalogo.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import FormularioProducto from '../FormularioProducto.tsx';

export const dynamic = 'force-dynamic';

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [p, listas, rubros] = await Promise.all([obtenerProducto(s, id), listasDePrecios(s), listarRubros(s)]);
  if (!p) notFound();
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{p.nombre}</h1>
      <FormularioProducto
        listas={listas}
        rubros={rubros.filter((r) => r.activo || r.id === p.rubroId)}
        inicial={{ ...p, id: p.id, codigo: p.codigo ?? '', rubroId: p.rubroId ?? '', tipo: p.tipo ?? '', urlWeb: p.urlWeb ?? '' }}
      />
    </main>
  );
}
