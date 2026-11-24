import type { SesionActiva } from '../../../lib/auth.ts';
import { puede, type Rol } from '../../../../../packages/seguridad/src/index.ts';
import type { SeccionAjustes } from './Secciones.tsx';

/** Las secciones de Ajustes que esta persona puede abrir (la interfaz solo oculta: cada pantalla valida en el servidor). */
export function seccionesDeAjustes(s: SesionActiva): SeccionAjustes[] {
  const u = { rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: null };
  const aj = puede(u, 'ajustes');
  return [
    { href: '/ajustes', texto: 'Todo' },
    ...(aj ? [{ href: '/ajustes/empresa', texto: 'Empresa' }] : []),
    ...(puede(u, 'permisos') ? [{ href: '/ajustes/usuarios', texto: 'Usuarios' }] : []),
    ...(puede(u, 'clientes') ? [{ href: '/clientes/categorias', texto: 'Clientes' }] : []),
    ...(aj ? [
      { href: '/ajustes/rubros', texto: 'Rubros' },
      { href: '/ajustes/medios', texto: 'Retenciones y medios' },
      { href: '/ajustes/cajas', texto: 'Cajas' },
      { href: '/ajustes/extras', texto: 'Datos extras' },
      { href: '/ajustes/costos-fijos', texto: 'Costos fijos' },
      { href: '/ajustes/importar', texto: 'Importar' },
      { href: '/ajustes/correo', texto: 'Correo' },
    ] : []),
  ];
}
