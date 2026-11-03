import { operadoresDisponibles } from '../../../lib/auth.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import SelectorOperador from './SelectorOperador.tsx';

export const dynamic = 'force-dynamic';

export default async function Operador() {
  const s = await sesionObligatoria();
  const operadores = await operadoresDisponibles(s);
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Cambiar de operador</h1>
      <p style={{ color: '#5c6d66', marginTop: 0 }}>Operando: {s.nombre}. Elegí quién toma el mostrador y poné su PIN. Los administradores entran con su contraseña.</p>
      <SelectorOperador operadores={operadores} actualId={s.usuarioId} />
    </main>
  );
}
