'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { anularDevolucion, registrarDevolucion } from '../../../lib/devoluciones.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export async function registrarDevolucionAccion(datos: Record<string, unknown>): Promise<{ error?: string; id?: string }> {
  const s = await sesionObligatoria();
  try {
    const r = await registrarDevolucion(s, { fecha: '', nota: '', ...datos, clave: datos.clave ?? randomUUID() });
    for (const p of ['/clientes', '/cajas', '/ventas']) revalidatePath(p, 'layout');
    return { id: r.id };
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function anularDevolucionAccion(id: string, motivo: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await anularDevolucion(s, id, motivo);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const p of ['/clientes', '/cajas', '/ventas', '/devoluciones']) revalidatePath(p, 'layout');
  return {};
}
