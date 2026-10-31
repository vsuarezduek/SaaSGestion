import { listarCajas } from '../../../../lib/cajas.ts';
import { buscarProveedoresParaCompra, categoriasDeCompra, datosParaEditarCompra, faltantesParaComprar } from '../../../../lib/compras.ts';
import { obtenerProveedor } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import NuevaCompra from './NuevaCompra.tsx';

export const dynamic = 'force-dynamic';

export default async function Nueva({ searchParams }: { searchParams: Promise<{ editar?: string; proveedor?: string; faltantes?: string }> }) {
  const { editar, proveedor, faltantes } = await searchParams;
  const s = await sesionObligatoria();
  const edicion = editar ? await datosParaEditarCompra(s, editar) : null;
  const [categorias, cajas, elegido, sugeridos] = await Promise.all([
    categoriasDeCompra(s), listarCajas(s),
    proveedor && !edicion ? obtenerProveedor(s, proveedor) : Promise.resolve(null),
    faltantes && !edicion ? faltantesParaComprar(s) : Promise.resolve([]),
  ]);
  const inicial = edicion?.proveedor ?? (elegido ? { id: elegido.id, nombre: elegido.nombre, saldo: elegido.saldo } : null);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{edicion ? `Editar compra N° ${edicion.numero}` : 'Nueva compra'}</h1>
      {editar && !edicion && <div style={{ background: '#fbeae0', color: '#b4571a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Esa compra no se puede editar: no existe o está anulada.</div>}
      <NuevaCompra
        key={edicion ? `editar-${editar}` : `nueva-${proveedor ?? ''}-${faltantes ?? ''}`}
        categorias={categorias}
        cajas={cajas.filter((c) => c.abierta).map((c) => ({ id: c.id, nombre: c.nombre, impuesto: c.impuestoTransaccion }))}
        proveedorInicial={inicial}
        edicion={edicion ? { compraId: editar!, numero: edicion.numero, datos: edicion.datos } : null}
        faltantes={sugeridos}
        puedeAgregarCategorias={s.rol === 'administrador' || s.permisos.includes('ajustes')}
      />
    </main>
  );
}
