// Permisos: reglas del prototipo, ahora aplicadas en el servidor.
//  - Todos los usuarios acceden a las secciones base.
//  - El administrador accede a todo.
//  - Los demás necesitan que el administrador les otorgue permisos extra.
export type Rol = 'administrador' | 'encargada' | 'atencion' | 'cocina' | 'marketing';
export type Seccion =
  | 'inicio' | 'ventas' | 'clientes' | 'proveedores' | 'compras' | 'cajas' | 'productos'
  | 'ajustes' | 'informes' | 'descargar' | 'permisos';

export const SECCIONES_BASE: readonly Seccion[] = ['inicio', 'ventas', 'clientes', 'proveedores', 'compras', 'cajas', 'productos'];
export const PERMISOS_EXTRA: readonly Seccion[] = ['ajustes', 'informes', 'descargar', 'permisos'];

export interface UsuarioAutorizable {
  rol: Rol;
  permisos: readonly string[];
  activo: boolean;
  cajasVisibles: readonly string[] | null; // null = todas
}

export function puede(u: UsuarioAutorizable, seccion: Seccion): boolean {
  if (!u.activo) return false;
  if (u.rol === 'administrador') return true;
  if ((SECCIONES_BASE as readonly string[]).includes(seccion)) return true;
  return u.permisos.includes(seccion);
}

export function puedeVerCaja(u: UsuarioAutorizable, cajaId: string): boolean {
  if (!u.activo) return false;
  if (u.rol === 'administrador' || u.cajasVisibles === null) return true;
  return u.cajasVisibles.includes(cajaId);
}

export function requierePassword(rol: Rol): boolean {
  return rol === 'administrador';
}
