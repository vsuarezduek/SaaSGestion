import { listasDePrecios } from '../../../../lib/catalogo.ts';
import { plantilla } from '../../../../lib/importar.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import Importador from './Importador.tsx';

export const dynamic = 'force-dynamic';

export default async function Importar() {
  const s = await sesionObligatoria();
  const listas = await listasDePrecios(s);
  const nombres = listas.map((l) => l.nombre);
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Importar listas</h1>
      <p style={{ color: '#5c6d66' }}>Cargá de una vez tus clientes, proveedores o productos desde una planilla. Siempre se muestra primero una vista previa —qué se crea, qué se modifica y qué filas tienen problemas— y recién ahí confirmás. Hasta ese momento no se guarda nada.</p>
      <Importador plantillas={{ clientes: plantilla('clientes', nombres), proveedores: plantilla('proveedores', nombres), productos: plantilla('productos', nombres) }} />
    </main>
  );
}
