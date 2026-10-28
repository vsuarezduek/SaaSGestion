'use server';
import { redirect } from 'next/navigation';
import { archivarProducto, guardarProducto } from '../../../lib/catalogo.ts';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export interface Resultado {
  error?: string;
}

export async function guardarProductoAccion(id: string | null, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await guardarProducto(s, id, datos);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  redirect('/productos');
}

export async function archivarProductoAccion(id: string, activo: boolean): Promise<void> {
  const s = await sesionObligatoria();
  await archivarProducto(s, id, activo);
  redirect('/productos');
}
