'use server';
import { revalidatePath } from 'next/cache';
import { archivarRubro, crearRubro, renombrarRubro } from '../../../lib/catalogo.ts';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export async function crearRubroAccion(_prev: { error?: string } | null, f: FormData): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await crearRubro(s, { nombre: String(f.get('nombre') ?? ''), padreId: String(f.get('padre') ?? '') || null });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) return { error: e.message };
    throw e;
  }
  revalidatePath('/rubros');
  return {};
}

export async function renombrarRubroAccion(f: FormData): Promise<void> {
  const s = await sesionObligatoria();
  try { await renombrarRubro(s, String(f.get('id')), String(f.get('nombre') ?? '')); } catch (e) { if (!(e instanceof ErrorDeUsuario)) throw e; }
  revalidatePath('/rubros');
}

export async function archivarRubroAccion(f: FormData): Promise<void> {
  const s = await sesionObligatoria();
  try { await archivarRubro(s, String(f.get('id')), f.get('activo') === 'true'); } catch (e) { if (!(e instanceof ErrorDeUsuario)) throw e; }
  revalidatePath('/rubros');
}
