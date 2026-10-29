import { listarRubros, listasDePrecios } from '../../../../lib/catalogo.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import FormularioProducto from '../FormularioProducto.tsx';

export const dynamic = 'force-dynamic';

export default async function NuevoProducto() {
  const s = await sesionObligatoria();
  const [listas, rubros] = await Promise.all([listasDePrecios(s), listarRubros(s)]);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nuevo producto</h1>
      <FormularioProducto
        listas={listas}
        rubros={rubros.filter((r) => r.activo)}
        inicial={{ id: null, codigo: '', nombre: '', rubroId: '', tipo: '', unidad: 'unidad', costo: '', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', activo: true, precios: {}, stockMinimo: '', stockIdeal: '' }}
      />
    </main>
  );
}
