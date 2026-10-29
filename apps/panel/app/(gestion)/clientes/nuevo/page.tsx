import { listarCategorias } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import FormularioPersona from '../../FormularioPersona.tsx';

export const dynamic = 'force-dynamic';

export default async function NuevoCliente() {
  const s = await sesionObligatoria();
  const cats = (await listarCategorias(s)).filter((c) => c.activa);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nuevo cliente</h1>
      <FormularioPersona tipo="cliente" categorias={cats} inicial={{ ...{ id: null, nombre: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: '', categoriaId: '', contacto: '', categoria: '', activo: true, esConsumidorFinal: false }, condicionIva: 'consumidor_final' }} />
    </main>
  );
}
