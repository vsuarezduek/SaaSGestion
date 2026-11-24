import { listarCategorias, ultimosClientesConOperaciones } from '../../../lib/personas.ts';
import { ETIQUETAS_COMPROBANTE } from '../../../lib/etiquetas.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { puede, type Rol } from '../../../../../packages/seguridad/src/index.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import PantallaClientes from './PantallaClientes.tsx';

export const dynamic = 'force-dynamic';

/**
 * Clientes como en el prototipo: de entrada el buscador (no la lista entera) y los últimos 10 con operaciones.
 * El listado completo se despliega aparte y se ordena con un click en cada columna.
 */
export default async function Clientes() {
  const s = await sesionObligatoria();
  const [ultimos, cats] = await Promise.all([ultimosClientesConOperaciones(s), listarCategorias(s)]);
  const permiso = (p: 'descargar' | 'informes') => puede({ rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: null }, p);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Clientes</h1>
      <PantallaClientes
        categorias={cats.filter((c) => c.activa).map((c) => ({ id: c.id, nombre: c.nombre }))}
        puedeDescargar={permiso('descargar')}
        puedeInformes={permiso('informes')}
        ultimos={ultimos.map((u) => ({
          clienteId: u.clienteId, nombre: u.nombre, ventaId: u.ventaId,
          detalle: `${ETIQUETAS_COMPROBANTE[u.comprobante] ?? u.comprobante} N° ${u.numero} · ${u.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
          total: `${u.comprobante === 'nota_credito' ? '−' : ''}${formatearPesos(aCentavos(u.total))}`,
        }))}
      />
    </main>
  );
}
