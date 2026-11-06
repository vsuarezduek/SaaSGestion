import { redirect } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { boton, botonSecundario, pagina, tarjeta } from '../../../lib/estilos.ts';
import { alertasDeStock } from '../../../lib/stock.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { puede, type Rol } from '../../../../../packages/seguridad/src/index.ts';
import { faltantesParaComprar } from '../../../lib/compras.ts';
import { actividadReciente, fraseDelDia, resumenDeHoy, totalActividad } from '../../../lib/inicio.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { listarPedidos } from '../../../lib/ventasAbiertas.ts';
import FechaYHora from './FechaYHora.tsx';
import PedirMercaderia, { type GrupoPedir } from './PedirMercaderia.tsx';
import Link from 'next/link';
import { sesionActual } from '../../../lib/sesion.ts';
import { salirAccion } from '../../ingresar/acciones.ts';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const ROLES: Record<Rol, string> = { administrador: 'Administrador', encargada: 'Encargada', atencion: 'Atención', cocina: 'Cocina', marketing: 'Marketing' };
const PASO_HISTORIAL = 25;
const chico: CSSProperties = { ...botonSecundario, textDecoration: 'none', padding: '4px 10px', fontSize: 13 };
const gris: CSSProperties = { fontSize: 12, color: '#5c6d66' };
const fila: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #d3e6de', fontSize: 14 };
const fechaEntrega = (iso: string) => iso.split('-').reverse().join('/');

/** Sección del Inicio que se abre y se cierra, cerrada de entrada (como en el prototipo). */
function Desplegable({ titulo, abierto = false, children }: { titulo: string; abierto?: boolean; children: ReactNode }) {
  return (
    <details open={abierto} style={tarjeta}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#1c9764', fontSize: 16 }}>{titulo}</summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}

export default async function Panel({ searchParams }: { searchParams: Promise<{ historial?: string }> }) {
  const sesion = await sesionActual();
  if (!sesion) redirect('/ingresar');
  const sp = await searchParams;
  const verHistorial = Math.min(Math.max(Number.parseInt(sp.historial ?? '', 10) || PASO_HISTORIAL, PASO_HISTORIAL), 500);

  const quien = { rol: sesion.rol as Rol, permisos: sesion.permisos, activo: true, cajasVisibles: null };
  const verMontos = puede(quien, 'informes');
  const esAdmin = puede(quien, 'ajustes');
  const sinPermiso = (e: unknown) => { if (e instanceof ErrorDePermiso) return null; throw e; };
  const [resumen, alertas, pedidos, faltantes, actividad, totalHistorial] = await Promise.all([
    resumenDeHoy(sesion),
    alertasDeStock(sesion),
    listarPedidos(sesion).catch(sinPermiso),
    faltantesParaComprar(sesion).catch(sinPermiso),
    esAdmin ? actividadReciente(sesion, verHistorial) : Promise.resolve([]),
    esAdmin ? totalActividad(sesion) : Promise.resolve(0),
  ]);
  const frase = fraseDelDia();
  const grupos: GrupoPedir[] = [];
  for (const f of faltantes ?? []) {
    const g = grupos.find((x) => x.proveedorId === f.proveedorId) ?? (grupos.push({ proveedorId: f.proveedorId, proveedor: f.proveedorNombre ?? 'Sin proveedor asignado', items: [] }), grupos[grupos.length - 1]!);
    g.items.push({ id: f.id, nombre: f.nombre, stock: formatearCantidad(f.stock), cantidad: formatearCantidad(f.cantidad), unidad: f.unidad, marcado: f.marcado });
  }
  const cuando = (d: Date) => new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' });
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const totalAlertas = alertas.negativos.length + alertas.bajoMinimo.length;
  const kpi: CSSProperties = { background: '#f0f8f5', borderRadius: 8, padding: '10px 12px' };

  return (
    <main style={{ ...pagina, maxWidth: 900 }}>
      <div style={tarjeta}>
        <FechaYHora inicial={new Date().toISOString()} />
        <p style={{ margin: '0 0 12px' }}>Operando como <b>{sesion.nombre}</b> ({ROLES[sesion.rol as Rol] ?? sesion.rol})</p>
        <form action={salirAccion}>
          <button type="submit" style={boton}>Cerrar sesión</button>
        </form>
      </div>

      <div style={{ ...tarjeta, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div style={kpi}><div style={{ fontSize: 14 }}>Sesión anterior</div><b>{resumen.sesionAnterior ? cuando(resumen.sesionAnterior) : 'Primera vez'}</b></div>
        {verMontos && <div style={kpi}><div style={{ fontSize: 14 }}>Ventas de hoy</div><b style={{ fontSize: 18 }}>{resumen.operaciones} · {formatearPesos(resumen.ventas)}</b></div>}
        {verMontos && <div style={kpi}><div style={{ fontSize: 14 }}>Ticket promedio de hoy</div><b style={{ fontSize: 18 }}>{formatearPesos(resumen.ticketPromedio)}</b></div>}
      </div>

      {pedidos && (
        <Desplegable titulo={`Pedidos de clientes (${pedidos.length})`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={gris}>Lo que los clientes encargaron: avisar cuando llega o entregar. No mueven stock ni caja hasta pasarlos a venta.</span>
            <Link href="/ventas" style={chico}>+ Nuevo</Link>
          </div>
          {pedidos.length === 0 && <div style={{ ...gris, padding: 6 }}>Sin pedidos pendientes.</div>}
          {pedidos.map((p) => {
            const vencido = p.entrega !== null && p.entrega < hoy;
            return (
              <div key={p.id} style={fila}>
                <span style={{ flex: '1 1 260px' }}>
                  <Link href={`/clientes/${p.clienteId}`} style={{ color: '#1c9764' }}><b>{p.cliente}</b></Link> · {formatearPesos(aCentavos(p.total))}
                  <div style={{ ...gris, color: vencido ? '#b4571a' : '#5c6d66' }}>
                    {p.entrega ? `Entrega ${fechaEntrega(p.entrega)}${vencido ? ' (vencida)' : ''}` : 'Sin fecha de entrega'}{p.nota ? ` · ${p.nota}` : ''}
                  </div>
                  <details style={gris}><summary style={{ cursor: 'pointer' }}>{p.renglones} producto{p.renglones === 1 ? '' : 's'}</summary>{p.items.map((i, n) => <div key={n}>{i}</div>)}</details>
                </span>
                <Link href={`/ventas/nueva?abierta=${p.id}`} style={chico}>Pasar a venta / editar</Link>
              </div>
            );
          })}
        </Desplegable>
      )}

      {faltantes && (
        <Desplegable titulo={`Pedido de mercadería pendiente (${faltantes.length})`}>
          <div style={gris}>Lo que falta y hay que pedir: productos bajo el mínimo y los marcados «para pedir» desde su ficha. Tildá y armá la compra por proveedor.</div>
          {grupos.length === 0 ? <div style={{ ...gris, padding: 6 }}>Nada pendiente.</div> : <PedirMercaderia grupos={grupos} />}
        </Desplegable>
      )}

      {totalAlertas > 0 && (
        <Desplegable titulo={`Alertas de stock (${totalAlertas})`}>
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
        </Desplegable>
      )}

      {esAdmin && (
        <Desplegable titulo={`Historial de actividad (${totalHistorial})`} abierto={sp.historial !== undefined}>
          <div style={gris}>Todo lo que se hace en el sistema, con el usuario que lo hizo.</div>
          {actividad.length === 0 && <div style={{ ...gris, padding: 6 }}>Sin actividad.</div>}
          {actividad.map((f, i) => (
            <div key={i} style={fila}>
              <span style={{ color: '#5c6d66' }}>{cuando(f.cuando)}</span> · {f.enlace ? <Link href={f.enlace} style={{ color: 'inherit' }}>{f.texto}</Link> : f.texto}
            </div>
          ))}
          {totalHistorial > actividad.length && (
            <Link href={`/panel?historial=${verHistorial + PASO_HISTORIAL}`} scroll={false} style={{ ...chico, display: 'inline-block', marginTop: 8 }}>Mostrar {PASO_HISTORIAL} más</Link>
          )}
        </Desplegable>
      )}

      <p style={{ color: '#5c6d66', fontStyle: 'italic', fontSize: 14 }}>«{frase.texto}» — {frase.autor}</p>
    </main>
  );
}
