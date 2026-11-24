import { categoriasDeProveedor, ultimosProveedoresConOperaciones } from '../../../lib/personas.ts';
import { ETIQUETAS_COMPROBANTE } from '../../../lib/etiquetas.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { puede, type Rol } from '../../../../../packages/seguridad/src/index.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import PantallaProveedores from './PantallaProveedores.tsx';

export const dynamic = 'force-dynamic';

/**
 * Proveedores como en el prototipo (igual que Clientes): de entrada el buscador y los últimos 10 con compras.
 * El listado completo se despliega aparte y se ordena con un click en cada columna.
 */
export default async function Proveedores() {
  const s = await sesionObligatoria();
  const permiso = (p: 'descargar' | 'informes' | 'compras') => puede({ rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: null }, p);
  const [ultimos, cats] = await Promise.all([permiso('compras') ? ultimosProveedoresConOperaciones(s) : Promise.resolve([]), categoriasDeProveedor(s)]);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Proveedores</h1>
      <PantallaProveedores
        categorias={cats}
        puedeDescargar={permiso('descargar')}
        puedeInformes={permiso('informes')}
        ultimos={ultimos.map((u) => ({
          proveedorId: u.proveedorId, nombre: u.nombre, compraId: u.compraId,
          detalle: `${ETIQUETAS_COMPROBANTE[u.comprobante] ?? u.comprobante} N° ${u.numero} · ${u.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
          total: formatearPesos(aCentavos(u.total)),
        }))}
      />
    </main>
  );
}
