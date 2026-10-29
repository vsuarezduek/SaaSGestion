'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { abrirCaja, cerrarCaja, guardarCaja, movimientoManual, revertirMovimientoCaja, transferir } from '../../../lib/cajas.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export interface Resultado { error?: string }

async function intentar(fn: (s: Awaited<ReturnType<typeof sesionObligatoria>>) => Promise<unknown>, rutas: string[]): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await fn(s);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const r of rutas) revalidatePath(r);
  return {};
}

export const guardarCajaAccion = (id: string | null, d: unknown) => intentar((s) => guardarCaja(s, id, d), ['/cajas']);
export const abrirCajaAccion = (id: string, d: unknown) => intentar((s) => abrirCaja(s, id, d), ['/cajas', `/cajas/${id}`]);
export const cerrarCajaAccion = (id: string, d: unknown) => intentar((s) => cerrarCaja(s, id, d), ['/cajas', `/cajas/${id}`, '/cajas/cierres']);
export const movimientoCajaAccion = (id: string, d: unknown) => intentar((s) => movimientoManual(s, id, d), ['/cajas', `/cajas/${id}`]);
export const transferirAccion = (d: unknown) => intentar((s) => transferir(s, d), ['/cajas', '/cajas/[id]']);
export const anularAccion = (id: string, mov: string) => intentar((s) => revertirMovimientoCaja(s, id, mov), ['/cajas', `/cajas/${id}`]);
