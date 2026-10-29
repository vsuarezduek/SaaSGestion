'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { ConflictoDeVersion, descartarAbierta, guardarAbierta } from '../../../lib/ventasAbiertas.ts';
import {
  anularVenta, buscarClientesParaVenta, buscarProductosParaVenta, cerrarVenta, guardarMedioDePago,
  type ClienteParaVenta, type ProductoParaVenta,
} from '../../../lib/ventas.ts';

export interface ResultadoCierre { error?: string; id?: string; numero?: number; avisosStock?: string[] }

export async function buscarClientesAccion(q: string): Promise<ClienteParaVenta[]> {
  return buscarClientesParaVenta(await sesionObligatoria(), q);
}

export async function buscarProductosAccion(q: string, listaId: string | null, ids?: string[]): Promise<ProductoParaVenta[]> {
  return buscarProductosParaVenta(await sesionObligatoria(), q, listaId, ids);
}

export async function cerrarVentaAccion(datos: unknown): Promise<ResultadoCierre> {
  const s = await sesionObligatoria();
  try {
    const r = await cerrarVenta(s, datos);
    revalidatePath('/ventas', 'layout');
    revalidatePath('/cajas', 'layout');
    revalidatePath('/productos', 'layout');
    return { id: r.id, numero: r.numero, avisosStock: r.avisosStock };
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function guardarMedioAccion(id: string | null, datos: unknown): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await guardarMedioDePago(s, id, datos);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/ventas', 'layout');
  return {};
}

export async function anularVentaAccion(id: string, motivo: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await anularVenta(s, id, motivo);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const r of ['/ventas', '/cajas', '/productos', '/clientes']) revalidatePath(r, 'layout');
  return {};
}

export async function guardarAbiertaAccion(id: string | null, version: number, datos: unknown): Promise<{ id?: string; version?: number; error?: string; conflicto?: boolean }> {
  const s = await sesionObligatoria();
  try {
    const r = await guardarAbierta(s, id, version, datos);
    return { id: r.id, version: r.version };
  } catch (e) {
    if (e instanceof ConflictoDeVersion) return { error: e.message, conflicto: true };
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function descartarAbiertaAccion(id: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await descartarAbierta(s, id);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/ventas', 'layout');
  return {};
}
