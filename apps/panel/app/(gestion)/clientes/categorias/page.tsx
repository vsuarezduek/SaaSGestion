import { listasDePrecios } from '../../../../lib/catalogo.ts';
import { listarCategorias } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import Categorias from './Categorias.tsx';

export const dynamic = 'force-dynamic';

export default async function CategoriasCliente() {
  const s = await sesionObligatoria();
  const [cats, listas] = await Promise.all([listarCategorias(s), listasDePrecios(s)]);
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Categorías de cliente</h1>
      <p style={{ color: '#5c6d66', fontSize: 14 }}>Cada categoría define la lista de precios, el descuento y si el cliente puede comprar en cuenta corriente.</p>
      <Categorias
        listas={listas}
        categorias={cats.map((c) => ({ id: c.id, nombre: c.nombre, listaId: c.listaId ?? '', cuentaCorriente: c.cuentaCorriente, descuento: String(c.descuento), ventaACosto: c.ventaACosto }))}
      />
    </main>
  );
}
