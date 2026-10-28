import { pagina } from '../lib/estilos.ts';

export default function Inicio() {
  const enProduccion = process.env.VERCEL_ENV === 'production';
  return (
    <main style={pagina}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>SaaS Gestión</h1>
      <p>Sistema en construcción (etapa 0).</p>
      <p>
        <a href="/ingresar">Ingresar</a>
        {enProduccion ? null : (
          <>
            {' · '}
            <a href="/comercios/nuevo">Crear comercio de prueba</a>
            {' · '}
            <a href="/diagnostico">Diagnóstico</a>
          </>
        )}
      </p>
    </main>
  );
}
