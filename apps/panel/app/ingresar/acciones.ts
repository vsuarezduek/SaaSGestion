'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cerrarSesion, ingresar } from '../../lib/auth.ts';
import { COOKIE_SESION, ipDe } from '../../lib/sesion.ts';

export async function ingresarAccion(datos: FormData): Promise<void> {
  const slug = String(datos.get('comercio') ?? '');
  const email = String(datos.get('email') ?? '');
  const contrasena = String(datos.get('contrasena') ?? '');
  if (!slug.trim() || !email.trim() || !contrasena) redirect('/ingresar?error=datos');

  const r = await ingresar({ slug, email, contrasena, ip: ipDe(await headers()) });
  if (!r.ok) redirect(`/ingresar?error=${r.motivo}`);

  (await cookies()).set(COOKIE_SESION, r.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: r.expiraEn,
  });
  redirect('/panel');
}

export async function salirAccion(): Promise<void> {
  const c = await cookies();
  await cerrarSesion(c.get(COOKIE_SESION)?.value);
  c.delete(COOKIE_SESION);
  redirect('/ingresar');
}
