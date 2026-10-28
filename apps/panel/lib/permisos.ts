// La interfaz solo oculta; la autorización se valida acá, en el servidor, en cada operación.
import { puede, type Rol, type Seccion } from '../../../packages/seguridad/src/index.ts';
import type { SesionActiva } from './auth.ts';

export class ErrorDePermiso extends Error {}

export function exigir(sesion: SesionActiva, seccion: Seccion): void {
  const autorizado = puede({ rol: sesion.rol as Rol, permisos: sesion.permisos, activo: true, cajasVisibles: null }, seccion);
  if (!autorizado) throw new ErrorDePermiso('No tenés permiso para esta sección');
}
