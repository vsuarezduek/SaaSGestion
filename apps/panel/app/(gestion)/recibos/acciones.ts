'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { anularRecibo, registrarRecibo } from '../../../lib/recibos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export async function registrarReciboAccion(datos: Record<string, unknown>): Promise<{ error?: string; id?: string }> {
  const s = await sesionObligatoria();
  try {
    const r = await registrarRecibo(s, { ventaId: null, fecha: '', nota: '', ...datos, clave: datos.clave ?? randomUUID() });
    for (const p of ['/clientes', '/cajas', '/ventas']) revalidatePath(p, 'layout');
    return { id: r.id };
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function anularReciboAccion(id: string, motivo: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await anularRecibo(s, id, motivo);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const p of ['/clientes', '/cajas', '/ventas', '/recibos']) revalidatePath(p, 'layout');
  return {};
}
