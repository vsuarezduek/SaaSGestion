import { notFound } from 'next/navigation';
import { boton, campo, error, etiqueta, pagina, tarjeta } from '../../../lib/estilos.ts';
import { crearComercioAccion } from './acciones.ts';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function NuevoComercio({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (process.env.VERCEL_ENV === 'production') notFound();
  const sp = await searchParams;
  return (
    <main style={pagina}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Crear comercio de prueba</h1>
      <p>Solo disponible fuera de producción. Usá datos de prueba.</p>
      {sp.error ? <div style={error}>{sp.error}</div> : null}
      <form action={crearComercioAccion} style={tarjeta}>
        <label style={etiqueta}>
          Identificador (minúsculas, números y guiones)
          <input name="slug" required style={campo} />
        </label>
        <label style={etiqueta}>
          Nombre del comercio
          <input name="nombre" required style={campo} />
        </label>
        <label style={etiqueta}>
          Rubro
          <input name="rubro" placeholder="general" style={campo} />
        </label>
        <label style={etiqueta}>
          Nombre del administrador
          <input name="nombreAdmin" required style={campo} />
        </label>
        <label style={etiqueta}>
          Correo del administrador
          <input name="email" type="email" required style={campo} />
        </label>
        <label style={etiqueta}>
          Contraseña (mínimo 8 caracteres)
          <input name="contrasena" type="password" required minLength={8} autoComplete="new-password" style={campo} />
        </label>
        <button type="submit" style={boton}>
          Crear comercio
        </button>
      </form>
    </main>
  );
}
