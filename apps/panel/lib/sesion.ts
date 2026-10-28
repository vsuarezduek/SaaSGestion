// Utilidades de sesión que usan Next (cookies y encabezados). La lógica está en auth.ts.
import { cookies } from 'next/headers';
import { sesionDesdeCookie, type SesionActiva } from './auth.ts';

export const COOKIE_SESION = 'sg_sesion';

export async function sesionActual(): Promise<SesionActiva | null> {
  const c = await cookies();
  return sesionDesdeCookie(c.get(COOKIE_SESION)?.value);
}

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
