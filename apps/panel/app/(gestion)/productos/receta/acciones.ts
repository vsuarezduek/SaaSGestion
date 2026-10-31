'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import {
  agregarIngrediente, anularElaboracion, aplicarCostoReceta, buscarIngredientes, fijarCantidadIngrediente, guardarInstrucciones, guardarRinde,
  previsualizarElaboracion, quitarIngrediente, registrarElaboracion,
} from '../../../../lib/recetas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';

export type Resultado = { error?: string; aviso?: string };

async function correr(productoId: string, f: (s: Awaited<ReturnType<typeof sesionObligatoria>>) => Promise<string | void>): Promise<Resultado> {
  const s = await sesionObligatoria();
  let aviso: string | undefined;
  try {
    aviso = (await f(s)) || undefined;
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath(`/productos/${productoId}`);
  return aviso ? { aviso } : {};
}

export async function agregarIngredienteAccion(productoId: string, ingredienteId: string): Promise<Resultado> {
  return correr(productoId, (s) => agregarIngrediente(s, productoId, ingredienteId));
}
export async function cantidadIngredienteAccion(productoId: string, ingredienteId: string, cantidad: string): Promise<Resultado> {
  return correr(productoId, (s) => fijarCantidadIngrediente(s, productoId, ingredienteId, cantidad));
}
export async function quitarIngredienteAccion(productoId: string, ingredienteId: string): Promise<Resultado> {
  return correr(productoId, (s) => quitarIngrediente(s, productoId, ingredienteId));
}
export async function rindeAccion(productoId: string, rinde: string): Promise<Resultado> {
  return correr(productoId, (s) => guardarRinde(s, productoId, rinde));
}
export async function instruccionesAccion(productoId: string, texto: string): Promise<Resultado> {
  return correr(productoId, (s) => guardarInstrucciones(s, productoId, texto));
}
export async function aplicarCostoAccion(productoId: string, mantenerUtilidad: boolean): Promise<Resultado> {
  return correr(productoId, async (s) => `Costo aplicado: $ ${await aplicarCostoReceta(s, productoId, mantenerUtilidad)}`);
}
export async function elaborarAccion(productoId: string, clave: string, cantidad: string, nota: string): Promise<Resultado> {
  return correr(productoId, async (s) => {
    const r = await registrarElaboracion(s, { clave, productoId, cantidad, fecha: '', nota });
    revalidatePath('/productos', 'layout');
    return r.faltantes.length ? `Elaboración registrada. Atención, quedó stock negativo en: ${r.faltantes.map((f) => f.nombre).join(', ')}` : 'Elaboración registrada';
  });
}
export async function anularElaboracionAccion(productoId: string, id: string, motivo: string): Promise<Resultado> {
  return correr(productoId, (s) => anularElaboracion(s, id, motivo));
}

export async function previewElaboracionAccion(productoId: string, cantidad: string): Promise<{ nombre: string; usa: string; stock: string; queda: string }[]> {
  const s = await sesionObligatoria();
  try {
    return await previsualizarElaboracion(s, productoId, cantidad);
  } catch (e) {
    if (e instanceof ErrorDePermiso) return [];
    throw e;
  }
}
export async function buscarIngredientesAccion(q: string, excluirId: string): Promise<{ id: string; nombre: string; costo: string; stock: string }[]> {
  const s = await sesionObligatoria();
  try {
    return await buscarIngredientes(s, q, excluirId);
  } catch (e) {
    if (e instanceof ErrorDePermiso) return [];
    throw e;
  }
}
