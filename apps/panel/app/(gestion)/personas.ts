'use server';
// Acciones compartidas por clientes y proveedores.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ErrorDeUsuario } from '../../lib/auth.ts';
import { archivarCliente, archivarProveedor, guardarCategoria, guardarCliente, guardarProveedor, registrarMovimiento, revertirMovimiento } from '../../lib/personas.ts';
import { ErrorDePermiso } from '../../lib/permisos.ts';
import { sesionObligatoria } from '../../lib/sesion.ts';

export interface Resultado { error?: string }
type Tipo = 'cliente' | 'proveedor';
const ruta = (t: Tipo) => (t === 'cliente' ? '/clientes' : '/proveedores');

async function intentar(fn: () => Promise<unknown>): Promise<Resultado> {
  try {
    await fn();
    return {};
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function guardarPersonaAccion(tipo: Tipo, id: string | null, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => (tipo === 'cliente' ? guardarCliente(s, id, datos) : guardarProveedor(s, id, datos)));
  if (r.error) return r;
  redirect(ruta(tipo));
}

export async function archivarPersonaAccion(tipo: Tipo, id: string, activo: boolean): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => (tipo === 'cliente' ? archivarCliente(s, id, activo) : archivarProveedor(s, id, activo)));
  if (r.error) return r;
  redirect(ruta(tipo));
}

export async function movimientoAccion(tipo: Tipo, id: string, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => registrarMovimiento(s, tipo === 'cliente' ? { cliente: id } : { proveedor: id }, datos));
  revalidatePath(`${ruta(tipo)}/${id}`);
  return r;
}

export async function revertirAccion(tipo: Tipo, id: string, movimientoId: string): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => revertirMovimiento(s, tipo === 'cliente' ? { cliente: id } : { proveedor: id }, movimientoId));
  revalidatePath(`${ruta(tipo)}/${id}`);
  return r;
}

export async function guardarCategoriaAccion(id: string | null, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => guardarCategoria(s, id, datos));
  revalidatePath('/clientes/categorias');
  return r;
}
