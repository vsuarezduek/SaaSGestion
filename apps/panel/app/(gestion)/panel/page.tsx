import { redirect } from 'next/navigation';
import { botonSecundario, pagina, tarjeta } from '../../../lib/estilos.ts';
import { alertasDeStock } from '../../../lib/stock.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { puede, type Rol } from '../../../../../packages/seguridad/src/index.ts';
import { faltantesParaComprar } from '../../../lib/compras.ts';
import { actividadReciente, fraseDelDia, resumenDeHoy } from '../../../lib/inicio.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { listarPedidos } from '../../../lib/ventasAbiertas.ts';
import PedirMercaderia, { type GrupoPedir } from './PedirMercaderia.tsx';
import Link from 'next/link';
import { sesionActual } from '../../../lib/sesion.ts';
import { salirAccion } from '../../ingresar/acciones.ts';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function Panel() {
  const sesion = await sesionActual();
  if (!sesion) redirect('/ingresar');

  const verMontos = puede({ rol: sesion.rol as Rol, permisos: sesion.permisos, activo: true, cajasVisibles: null }, 'informes');
  const esAdmin = puede({ rol: sesion.rol as Rol, permisos: sesion.permisos, activo: true, cajasVisibles: null }, 'ajustes');
  const sinPermiso = (e: unknown) => { if (e instanceof ErrorDePermiso) return null; throw e; };
  const [resumen, alertas, pedidos, faltantes, actividad] = await Promise.all([
    resumenDeHoy(sesion),
    alertasDeStock(sesion),
    listarPedidos(sesion).catch(sinPermiso),
    faltantesParaComprar(sesion).catch(sinPermiso),
    esAdmin ? actividadReciente(sesion) : Promise.resolve([]),
  ]);
  const frase = fraseDelDia();
  const grupos: GrupoPedir[] = [];
  for (const f of faltantes ?? []) {
    const g = grupos.find((x) => x.proveedorId === f.proveedorId) ?? (grupos.push({ proveedorId: f.proveedorId, proveedor: f.proveedorNombre ?? 'Sin proveedor asignado', items: [] }), grupos[grupos.length - 1]!);
    g.items.push({ id: f.id, nombre: f.nombre, stock: formatearCantidad(f.stock), cantidad: formatearCantidad(f.cantidad), unidad: f.unidad, marcado: f.marcado });
  }
  const cuando = (d: Date) => new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' });

  return (
    <main style={pagina}>
      <h1 style={{ fontFamily: 'Georgia, serif', marginBottom: 4 }}>{sesion.comercio}</h1>
      <p style={{ marginTop: 0, color: '#5c6d66' }}>
        {sesion.nombre} · {sesion.rol}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        {verMontos && <div style={{ ...tarjeta, marginBottom: 0 }}><div style={{ fontSize: 12, color: '#5c6d66' }}>Ventas de hoy</div><b style={{ fontSize: 18 }}>{formatearPesos(resumen.ventas)}</b><div style={{ fontSize: 12, color: '#5c6d66' }}>{resumen.operaciones} operaciones · ticket {formatearPesos(resumen.ticketPromedio)}</div></div>}
        <div style={{ ...tarjeta, marginBottom: 0 }}><div style={{ fontSize: 12, color: '#5c6d66' }}>Sesión anterior</div><b>{resumen.sesionAnterior ? cuando(resumen.sesionAnterior) : 'Primera vez'}</b></div>
      </div>
      {(alertas.negativos.length > 0 || alertas.bajoMinimo.length > 0) && (
        <div style={tarjeta}>
          <b>Alertas de stock</b>
          {alertas.negativos.map((a) => (
            <div key={a.id} style={{ padding: '4px 0', fontSize: 14, color: '#b4571a' }}>
              ⚠ <Link href={`/productos/${a.id}`} style={{ color: 'inherit' }}>{a.nombre}</Link>: stock negativo ({formatearCantidad(a.stock)})
            </div>
          ))}
          {alertas.bajoMinimo.map((a) => (
            <div key={a.id} style={{ padding: '4px 0', fontSize: 14, color: '#8a6d00' }}>
              <Link href={`/productos/${a.id}`} style={{ color: 'inherit' }}>{a.nombre}</Link>: {formatearCantidad(a.stock)} (mínimo {formatearCantidad(a.minimo)})
            </div>
          ))}
        </div>
      )}
      {pedidos && pedidos.length > 0 && (
        <div style={tarjeta}>
          <b>Pedidos pendientes ({pedidos.length})</b>
          {pedidos.slice(0, 8).map((p) => (
            <div key={p.id} style={{ padding: '4px 0', fontSize: 14 }}>
              <Link href={`/ventas/nueva?abierta=${p.id}`} style={{ color: 'inherit' }}>{p.cliente}</Link> · {formatearPesos(aCentavos(p.total))}{p.entrega ? ` · entrega ${p.entrega}` : ''}
            </div>
          ))}
          {pedidos.length > 8 && <Link href="/ventas" style={{ fontSize: 13 }}>Ver los {pedidos.length}</Link>}
        </div>
      )}
      {grupos.length > 0 && (
        <div style={tarjeta}>
          <b>Mercadería a pedir</b>
          <PedirMercaderia grupos={grupos} />
        </div>
      )}
      {esAdmin && actividad.length > 0 && (
        <div style={tarjeta}>
          <b>Historial de actividad</b>
          {actividad.map((f, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #d3e6de', fontSize: 14 }}>
              <span style={{ color: '#5c6d66' }}>{cuando(f.cuando)}</span> · {f.enlace ? <Link href={f.enlace} style={{ color: 'inherit' }}>{f.texto}</Link> : f.texto}
            </div>
          ))}
        </div>
      )}
      <p style={{ color: '#5c6d66', fontStyle: 'italic', fontSize: 14 }}>«{frase.texto}» — {frase.autor}</p>
      <form action={salirAccion}>
        <button type="submit" style={botonSecundario}>
          Salir
        </button>
      </form>
    </main>
  );
}
