// Utilidades de sesión que usan Next (cookies y encabezados). La lógica está en auth.ts.
import { cookies } from 'next/headers';
import { cache } from 'react';
import { sesionDesdeCookie, type SesionActiva } from './auth.ts';

export const COOKIE_SESION = 'sg_sesion';

/**
 * La sesión se consulta una sola vez por pedido: el menú (layout) y la página la comparten.
 * Antes cada uno iba a la base por su cuenta.
 */
export const sesionActual = cache(async (): Promise<SesionActiva | null> => {
  const c = await cookies();
  return sesionDesdeCookie(c.get(COOKIE_SESION)?.value);
});

/** IP del visitante según Vercel (primer valor de x-forwarded-for). */
export function ipDe(h: Headers): string {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'desconocida';
}

/** Para páginas y acciones del panel: devuelve la sesión o manda a ingresar. */
export async function sesionObligatoria(): Promise<SesionActiva> {
  const { redirect } = await import('next/navigation');
  const s = await sesionActual();
  if (!s) redirect('/ingresar');
  return s as SesionActiva;
}
