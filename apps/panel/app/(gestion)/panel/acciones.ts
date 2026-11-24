'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { agregarMercaderiaManual, quitarMercaderiaManual } from '../../../lib/aPedir.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

type Resultado = { error?: string };

async function intentar(f: () => Promise<unknown>): Promise<Resultado> {
  try { await f(); } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/panel');
  return {};
}

export async function agregarMercaderiaAccion(datos: { descripcion: string; cantidad: string; proveedorId: string | null }): Promise<Resultado> {
  const s = await sesionObligatoria();
  return intentar(() => agregarMercaderiaManual(s, datos));
}

export async function quitarMercaderiaAccion(id: string): Promise<Resultado> {
  const s = await sesionObligatoria();
  return intentar(() => quitarMercaderiaManual(s, id));
}
