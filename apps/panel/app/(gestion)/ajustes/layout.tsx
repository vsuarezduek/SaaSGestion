import type { ReactNode } from 'react';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import Secciones from './Secciones.tsx';
import { seccionesDeAjustes } from './secciones.ts';

/** Todas las pantallas de Ajustes llevan arriba los botones de sección, como el prototipo. */
export default async function LayoutAjustes({ children }: { children: ReactNode }) {
  const s = await sesionObligatoria();
  return (
    <>
      <Secciones secciones={seccionesDeAjustes(s)} />
      {children}
    </>
  );
}
