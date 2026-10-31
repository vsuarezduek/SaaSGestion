'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { importarLista, type ResultadoImportacion, type TipoImportacion } from '../../../lib/importar.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export async function importarAccion(tipo: TipoImportacion, texto: string, actualizar: boolean, simular: boolean): Promise<{ error?: string; resultado?: ResultadoImportacion }> {
  const s = await sesionObligatoria();
  try {
    const resultado = await importarLista(s, tipo, texto, { actualizar, simular });
    if (!simular) for (const p of ['/clientes', '/proveedores', '/productos', '/rubros']) revalidatePath(p, 'layout');
    return { resultado };
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}
