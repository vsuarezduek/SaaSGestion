import { listasDePrecios } from '../../../lib/catalogo.ts';
import { plantilla } from '../../../lib/importar.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import Importador from './Importador.tsx';

export const dynamic = 'force-dynamic';

export default async function Importar() {
  const s = await sesionObligatoria();
  const listas = await listasDePrecios(s);
  const nombres = listas.map((l) => l.nombre);
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Importar listas</h1>
      <p style={{ color: '#5c6d66' }}>Cargá de una vez tus clientes, proveedores o productos desde una planilla. Primero conviene «Revisar sin importar»: muestra qué se crearía y qué filas tienen problemas, sin guardar nada.</p>
      <Importador plantillas={{ clientes: plantilla('clientes', nombres), proveedores: plantilla('proveedores', nombres), productos: plantilla('productos', nombres) }} />
    </main>
  );
}
