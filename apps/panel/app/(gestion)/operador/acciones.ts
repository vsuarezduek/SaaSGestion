'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cambiarOperador, cerrarSesion } from '../../../lib/auth.ts';
import { COOKIE_SESION, ipDe, sesionObligatoria } from '../../../lib/sesion.ts';

/** Pasa el mostrador a otra persona: si el PIN es correcto abre su sesión y cierra la actual. */
export async function cambiarOperadorAccion(usuarioId: string, pin: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  const jar = await cookies();
  const r = await cambiarOperador(s, usuarioId, pin, ipDe(await headers()));
  if (!r.ok) return { error: r.motivo === 'bloqueado' ? 'Demasiados intentos. Esperá unos minutos.' : 'PIN incorrecto' };
  await cerrarSesion(jar.get(COOKIE_SESION)?.value);
  jar.set(COOKIE_SESION, r.cookie, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: r.expiraEn });
  redirect('/panel');
}
