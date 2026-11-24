import Link from 'next/link';
import { listarProductos, listarRubros, listasDePrecios, tiposDeProducto } from '../../../lib/catalogo.ts';
import { datosExtraConValores, proveedoresParaProducto } from '../../../lib/extras.ts';
import { boton, campo, tarjeta } from '../../../lib/estilos.ts';
import { puede, type Rol } from '../../../../../packages/seguridad/src/index.ts';
import { Seccion } from '../Orden.tsx';
import PantallaProductos from './PantallaProductos.tsx';
import TablaProductos from './TablaProductos.tsx';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export const dynamic = 'force-dynamic';

type Params = { q?: string; rubro?: string; tipo?: string; estado?: string; alerta?: string; limite?: string; proveedor?: string; extra?: string; valor?: string; listado?: string };

export default async function Productos({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const limite = Math.min(Number(p.limite) || 50, 500);
  const estado = p.estado === 'archivados' || p.estado === 'todos' ? p.estado : 'activos';
  // El listado con filtros se arma recién cuando se pide (como el prototipo: de entrada, solo el buscador).
  const conListado = Boolean(p.listado || p.q || p.rubro || p.tipo || p.proveedor || p.extra || p.alerta || (p.estado && p.estado !== 'activos'));
  const permiso = (x: 'descargar' | 'informes') => puede({ rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: null }, x);
  const [{ filas, total }, listas, rubros, tipos, proveedores, extras] = await Promise.all([
    !conListado ? Promise.resolve({ filas: [], total: 0 }) : listarProductos(s, { q: p.q, rubroId: p.rubro || undefined, tipo: p.tipo || undefined, estado, limite, alerta: p.alerta === 'negativo' || p.alerta === 'bajo_minimo' ? p.alerta : undefined,
      proveedorId: p.proveedor || undefined, extraId: p.extra || undefined, extraValor: p.extra && p.valor ? p.valor : undefined }),
    listasDePrecios(s),
    listarRubros(s),
    tiposDeProducto(s),
    proveedoresParaProducto(s),
    datosExtraConValores(s),
  ]);
  const extraElegido = extras.find((x) => x.id === p.extra);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Productos</h1>
      <PantallaProductos tipos={tipos} lista={listas[0] ? { id: listas[0].id, nombre: listas[0].nombre } : null} puedeDescargar={permiso('descargar')} puedeMasiva={s.rol === 'administrador' || s.permisos.includes('ajustes')} />
      <Seccion titulo={conListado ? `Listado con filtros (${total})` : 'Listado con filtros'} abiertoInicial={conListado} estilo={{ ...tarjeta, overflowX: 'auto' }}>
      <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input type="hidden" name="listado" value="1" />
        <input name="q" defaultValue={p.q ?? ''} placeholder="Buscar por nombre, código o tipo" style={{ ...campo, flex: '2 1 220px', marginTop: 0 }} />
        <select name="rubro" defaultValue={p.rubro ?? ''} style={{ ...campo, flex: '1 1 160px', marginTop: 0 }}>
          <option value="">Todos los rubros</option>
          {rubros.filter((r) => r.activo).map((r) => (
            <option key={r.id} value={r.id}>{r.ruta}</option>
          ))}
        </select>
        <select name="tipo" defaultValue={p.tipo ?? ''} style={{ ...campo, flex: '1 1 120px', marginTop: 0 }}>
          <option value="">Todos los tipos</option>
          {tipos.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select name="proveedor" defaultValue={p.proveedor ?? ''} style={{ ...campo, flex: '1 1 160px', marginTop: 0 }}>
          <option value="">Todos los proveedores</option>
          {proveedores.map((x) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}
        </select>
        {extras.length > 0 && (
          <select name="extra" defaultValue={p.extra ?? ''} style={{ ...campo, flex: '1 1 140px', marginTop: 0 }}>
            <option value="">Dato extra…</option>
            {extras.map((x) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}
          </select>
        )}
        {extraElegido && (
          <select name="valor" defaultValue={p.valor ?? ''} style={{ ...campo, flex: '1 1 140px', marginTop: 0 }}>
            <option value="">Cualquier valor</option>
            {extraElegido.valores.map((v) => (<option key={v} value={v}>{v}</option>))}
          </select>
        )}
        <select name="estado" defaultValue={estado} style={{ ...campo, flex: '1 1 120px', marginTop: 0 }}>
          <option value="activos">Activos</option>
          <option value="archivados">Archivados</option>
          <option value="todos">Todos</option>
        </select>
        <select name="alerta" defaultValue={p.alerta ?? ''} style={{ ...campo, flex: '1 1 140px', marginTop: 0 }}>
          <option value="">Todo el stock</option><option value="negativo">Stock negativo</option><option value="bajo_minimo">Bajo el mínimo</option>
        </select>
        <button type="submit" style={boton}>{conListado ? 'Filtrar' : 'Ver listado'}</button>
      </form>
      {conListado && (
      <div>
        <div style={{ fontSize: 12, color: '#5c6d66', marginBottom: 4 }}>Click en una columna para ordenar lo que se ve.</div>
        <TablaProductos filas={filas} listas={listas.map((l) => ({ id: l.id, nombre: l.nombre }))} />
        <p style={{ fontSize: 13, color: '#5c6d66' }}>Mostrando {filas.length} de {total}.</p>
        {filas.length < total && (
          <Link href={{ pathname: '/productos', query: { ...p, listado: '1', limite: String(limite + 50) } }} style={{ color: '#1c9764' }}>Mostrar más</Link>
        )}
      </div>
      )}
      </Seccion>
      {permiso('informes') && (
        <div style={tarjeta}>
          <Link href="/estadisticas/productos" style={{ color: '#1c9764', fontWeight: 700, textDecoration: 'none' }}>Informes de productos →</Link>
          <div style={{ fontSize: 12, color: '#5c6d66' }}>Ranking de productos, productos por proveedor y productos filtrados, con CSV.</div>
        </div>
      )}
    </main>
  );
}
