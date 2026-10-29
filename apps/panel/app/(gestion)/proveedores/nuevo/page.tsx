import { categoriasDeProveedor } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import FormularioPersona from '../../FormularioPersona.tsx';

export const dynamic = 'force-dynamic';

export default async function NuevoProveedor() {
  const s = await sesionObligatoria();
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nuevo proveedor</h1>
      <FormularioPersona tipo="proveedor" categoriasProveedor={await categoriasDeProveedor(s)} inicial={{ id: null, nombre: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: '', categoriaId: '', contacto: '', categoria: '', activo: true, esConsumidorFinal: false }} />
    </main>
  );
}
