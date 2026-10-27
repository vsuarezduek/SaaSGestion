'use server';

import { redirect } from 'next/navigation';
import { crearComercio, ErrorDeUsuario } from '../../../lib/auth.ts';

export async function crearComercioAccion(datos: FormData): Promise<void> {
  // Etapa 0: solo para crear comercios de prueba. Nunca en producción.
  if (process.env.VERCEL_ENV === 'production') redirect('/');
  const campo = (n: string): string => String(datos.get(n) ?? '');
  let destino: string;
  try {
    await crearComercio({
      slug: campo('slug'),
      nombre: campo('nombre'),
      rubro: campo('rubro'),
      email: campo('email'),
      nombreAdmin: campo('nombreAdmin'),
      contrasena: campo('contrasena'),
    });
    destino = `/ingresar?creado=${encodeURIComponent(campo('slug').trim().toLowerCase())}`;
  } catch (e) {
    if (!(e instanceof ErrorDeUsuario)) throw e;
    destino = `/comercios/nuevo?error=${encodeURIComponent(e.message)}`;
  }
  redirect(destino);
}
