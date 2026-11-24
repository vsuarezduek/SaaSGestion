import Link from 'next/link';
import { listarVentas } from '../../../lib/ventas.ts';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../lib/etiquetas.ts';
import { boton, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import BuscadorNuevaVenta from './BuscadorNuevaVenta.tsx';
import ListaPedidos from './ListaPedidos.tsx';
import { listarAbiertas, listarPedidos } from '../../../lib/ventasAbiertas.ts';
import DescartarAbierta from './DescartarAbierta.tsx';
import UltimasVentas from './UltimasVentas.tsx';
import { Seccion } from '../Orden.tsx';
import { listarCategorias } from '../../../lib/personas.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export default async function Ventas({ searchParams }: { searchParams: Promise<{ q?: string; todas?: string }> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const [ventas, abiertas, pedidos, cats] = await Promise.all([
    listarVentas(s, { q: p.q, limite: p.todas || p.q ? 100 : 10 }), listarAbiertas(s), listarPedidos(s),
    // Para el alta de cliente en la ventana emergente; si quien vende no ve Clientes, se crea sin categoría.
    listarCategorias(s).then((l) => l.filter((c) => c.activa).map((c) => ({ id: c.id, nombre: c.nombre }))).catch(() => []),
  ]);
  const hora = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Ventas</h1>
      <BuscadorNuevaVenta categorias={cats} />
      <ListaPedidos pedidos={pedidos} />
      <Seccion titulo={`Ventas abiertas (${abiertas.length})`} abiertoInicial estilo={{ ...tarjeta, ...(abiertas.length ? { borderColor: '#f0c36b', background: '#fffaf0' } : {}) }}>
          {abiertas.length === 0 && <div style={{ fontSize: 13, color: '#5c6d66' }}>No hay ventas abiertas.</div>}
          {abiertas.length > 0 && <div style={{ fontSize: 12, color: '#5c6d66', marginBottom: 6 }}>Las ven todos los usuarios: cualquiera puede continuarlas o cerrarlas.</div>}
          {abiertas.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #f3e3bf' }}>
              <span style={{ flex: '1 1 220px' }}>
                <b>{a.cliente}</b> · {a.renglones} ítem{a.renglones === 1 ? '' : 's'} · {formatearPesos(aCentavos(a.total))}
                <div style={{ fontSize: 12, color: '#5c6d66' }}>Cargada por {a.creadaPor ?? '—'} · última modificación {hora(a.modificadoEn)}{a.modificadaPor && a.modificadaPor !== a.creadaPor ? ` (${a.modificadaPor})` : ''}</div>
              </span>
              <Link href={`/ventas/nueva?abierta=${a.id}`} style={{ ...boton, textDecoration: 'none' }}>Continuar</Link>
              <DescartarAbierta id={a.id} />
            </div>
          ))}
      </Seccion>
      <UltimasVentas
        titulo={p.q ? 'Resultados' : p.todas ? 'Ventas' : 'Últimas 10 ventas'}
        abiertoInicial={Boolean(p.q || p.todas)}
        verMas={!p.q && !p.todas && ventas.length >= 10}
        filas={ventas.map((v) => ({
          id: v.id, numero: v.numero, fechaMs: v.fecha.getTime(), fecha: v.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
          cliente: v.cliente, comprobante: ETIQUETAS[v.comprobante] ?? v.comprobante, cobro: v.cobro,
          total: (v.comprobante === 'nota_credito' ? -1 : 1) * aCentavos(v.total), totalTexto: `${v.comprobante === 'nota_credito' ? '−' : ''}${formatearPesos(aCentavos(v.total))}`,
          anulada: v.estado === 'anulada', editable: v.estado === 'cerrada' && v.comprobante !== 'nota_credito',
        }))}
      />
    </main>
  );
}
