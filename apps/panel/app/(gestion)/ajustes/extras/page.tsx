import { listarDatosExtra } from '../../../../lib/extras.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import ListaDatosExtra from './ListaDatosExtra.tsx';

export const dynamic = 'force-dynamic';

export default async function DatosExtra() {
  const s = await sesionObligatoria();
  const datos = await listarDatosExtra(s);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Datos extras de los productos</h1>
      <p style={{ color: '#5c6d66' }}>Datos propios de tu negocio que querés cargar en cada producto (por ejemplo «Lista mayorista» o «Ferias»). Podés renombrarlos, agregar los que necesites o quitar los que no uses. Se usan en la ficha del producto, en los filtros, en las listas de precios y al importar o exportar.</p>
      <ListaDatosExtra datos={datos} />
    </main>
  );
}
