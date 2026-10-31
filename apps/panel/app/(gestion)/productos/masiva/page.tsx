import { listarRubros, listasDePrecios } from '../../../../lib/catalogo.ts';
import { proveedoresParaProducto } from '../../../../lib/extras.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import Masiva from './Masiva.tsx';

export const dynamic = 'force-dynamic';

export default async function ModificacionMasiva() {
  const s = await sesionObligatoria();
  const [listas, rubros, proveedores] = await Promise.all([listasDePrecios(s), listarRubros(s), proveedoresParaProducto(s)]);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Modificación masiva de costos</h1>
      <p style={{ color: '#5c6d66' }}>Sube o baja el costo de todos los productos de un proveedor y/o rubro. Primero «Ver qué cambiaría»: no guarda nada. Cada producto queda con su historial de cambios.</p>
      <Masiva listas={listas} rubros={rubros.filter((r) => r.activo).map((r) => ({ id: r.id, ruta: r.ruta }))} proveedores={proveedores} />
    </main>
  );
}
