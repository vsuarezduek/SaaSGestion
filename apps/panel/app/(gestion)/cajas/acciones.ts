'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { abrirCaja, cerrarCaja, guardarCaja, movimientoManual, revertirMovimientoCaja, transferir } from '../../../lib/cajas.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export interface Resultado { error?: string }

async function intentar(fn: (s: Awaited<ReturnType<typeof sesionObligatoria>>) => Promise<unknown>): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await fn(s);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/cajas', 'layout'); // lista, detalle e historial de cierres
  return {};
}

export async function guardarCajaAccion(id: string | null, d: unknown): Promise<Resultado> {
  return intentar((s) => guardarCaja(s, id, d));
}
export async function abrirCajaAccion(id: string, d: unknown): Promise<Resultado> {
  return intentar((s) => abrirCaja(s, id, d));
}
export async function cerrarCajaAccion(id: string, d: unknown): Promise<Resultado> {
  return intentar((s) => cerrarCaja(s, id, d));
}
export async function movimientoCajaAccion(id: string, d: unknown): Promise<Resultado> {
  return intentar((s) => movimientoManual(s, id, d));
}
export async function transferirAccion(d: unknown): Promise<Resultado> {
  return intentar((s) => transferir(s, d));
}
export async function anularAccion(id: string, mov: string): Promise<Resultado> {
  return intentar((s) => revertirMovimientoCaja(s, id, mov));
}
