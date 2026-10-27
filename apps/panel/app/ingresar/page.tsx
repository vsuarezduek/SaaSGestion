import { aviso, boton, campo, error, etiqueta, pagina, tarjeta } from '../../lib/estilos.ts';
import { ingresarAccion } from './acciones.ts';

export const dynamic = 'force-dynamic';

const MENSAJES: Record<string, string> = {
  credenciales: 'Comercio, correo o contraseña incorrectos.',
  bloqueado: 'Demasiados intentos fallidos. Probá de nuevo en 15 minutos.',
  datos: 'Completá todos los campos.',
};

export default async function Ingresar({ searchParams }: { searchParams: Promise<{ error?: string; creado?: string }> }) {
  const sp = await searchParams;
  const mensaje = sp.error ? (MENSAJES[sp.error] ?? 'No se pudo ingresar.') : null;
  return (
    <main style={pagina}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Ingresar</h1>
      {sp.creado ? <div style={aviso}>Comercio creado. Ingresá con el correo y la contraseña que cargaste.</div> : null}
      {mensaje ? <div style={error}>{mensaje}</div> : null}
      <form action={ingresarAccion} style={tarjeta}>
        <label style={etiqueta}>
          Comercio (identificador)
          <input name="comercio" defaultValue={sp.creado ?? ''} required autoComplete="organization" style={campo} />
        </label>
        <label style={etiqueta}>
          Correo
          <input name="email" type="email" required autoComplete="username" style={campo} />
        </label>
        <label style={etiqueta}>
          Contraseña
          <input name="contrasena" type="password" required autoComplete="current-password" style={campo} />
        </label>
        <button type="submit" style={boton}>
          Ingresar
        </button>
      </form>
    </main>
  );
}
