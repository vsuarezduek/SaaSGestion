import { listarCajas } from '../../../../lib/cajas.ts';
import { buscarProveedoresParaCompra, categoriasDeCompra, datosParaEditarCompra, faltantesParaComprar } from '../../../../lib/compras.ts';
import { obtenerCompraAbierta } from '../../../../lib/comprasAbiertas.ts';
import { obtenerProveedor } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import NuevaCompra from './NuevaCompra.tsx';

export const dynamic = 'force-dynamic';

export default async function Nueva({ searchParams }: { searchParams: Promise<{ editar?: string; proveedor?: string; faltantes?: string; ids?: string; abierta?: string }> }) {
  const { editar, proveedor, faltantes, ids, abierta: abiertaId } = await searchParams;
  const s = await sesionObligatoria();
  const edicion = editar ? await datosParaEditarCompra(s, editar) : null;
  const abierta = abiertaId && !edicion ? await obtenerCompraAbierta(s, abiertaId) : null;
  const [categorias, cajas, elegido, sugeridos] = await Promise.all([
    categoriasDeCompra(s), listarCajas(s),
    proveedor && !edicion ? obtenerProveedor(s, proveedor) : Promise.resolve(null),
    faltantes && !edicion ? faltantesParaComprar(s, { proveedorId: faltantes === 'proveedor' ? proveedor : undefined, ids: ids ? ids.split(',') : undefined }) : Promise.resolve([]),
  ]);
  const inicial = edicion?.proveedor ?? abierta?.proveedor ?? (elegido ? { id: elegido.id, nombre: elegido.nombre, saldo: elegido.saldo } : null);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{edicion ? `Editar compra N° ${edicion.numero}` : abierta ? 'Compra abierta' : 'Nueva compra'}</h1>
      {editar && !edicion && <div style={{ background: '#fbeae0', color: '#b4571a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Esa compra no se puede editar: no existe o está anulada.</div>}
      {abiertaId && !abierta && !edicion && <div style={{ background: '#fbeae0', color: '#b4571a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Esa compra abierta ya no está disponible (se cerró o se descartó). Podés cargar una nueva.</div>}
      <NuevaCompra
        key={edicion ? `editar-${editar}` : abierta ? `abierta-${abierta.id}` : `nueva-${proveedor ?? ''}-${faltantes ?? ''}`}
        categorias={categorias}
        cajas={cajas.filter((c) => c.abierta).map((c) => ({ id: c.id, nombre: c.nombre, impuesto: c.impuestoTransaccion }))}
        proveedorInicial={inicial}
        abierta={abierta ? { id: abierta.id, version: abierta.version, datos: abierta.datos } : null}
        edicion={edicion ? { compraId: editar!, numero: edicion.numero, datos: edicion.datos } : null}
        faltantes={sugeridos}
        puedeAgregarCategorias={s.rol === 'administrador' || s.permisos.includes('ajustes')}
      />
    </main>
  );
}
