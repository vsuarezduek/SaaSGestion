import Link from 'next/link';
import { listarVentas } from '../../../lib/ventas.ts';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../lib/etiquetas.ts';
import { boton, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import BuscadorNuevaVenta from './BuscadorNuevaVenta.tsx';
import ListaPedidos from './ListaPedidos.tsx';
import { listarAbiertas, listarPedidos } from '../../../lib/ventasAbiertas.ts';
import DescartarAbierta from './DescartarAbierta.tsx';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export default async function Ventas({ searchParams }: { searchParams: Promise<{ q?: string; todas?: string }> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const [ventas, abiertas, pedidos] = await Promise.all([listarVentas(s, { q: p.q, limite: p.todas || p.q ? 100 : 10 }), listarAbiertas(s), listarPedidos(s)]);
  const hora = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Ventas</h1>
      <BuscadorNuevaVenta />
      <p style={{ fontSize: 13 }}><Link href="/ventas/nota-de-credito/nueva" style={{ color: '#1b5f63', fontWeight: 600 }}>Nota de crédito sin venta de origen</Link></p>
      <ListaPedidos pedidos={pedidos} />
      {abiertas.length > 0 && (
        <div style={{ ...tarjeta, borderColor: '#f0c36b', background: '#fffaf0' }}>
          <b>Ventas abiertas ({abiertas.length})</b>
          <div style={{ fontSize: 12, color: '#5c6d66', marginBottom: 6 }}>Las ven todos los usuarios: cualquiera puede continuarlas o cerrarlas.</div>
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
        </div>
      )}
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <b>{p.q ? 'Resultados' : 'Últimas ventas'}</b>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>N°</th><th style={celda}>Fecha</th><th style={celda}>Cliente</th><th style={celda}>Comprobante</th><th style={celda}>Cobro</th><th style={celda}>Total</th><th style={celda}></th></tr></thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} style={{ opacity: v.estado === 'anulada' ? 0.5 : 1 }}>
                <td style={celda}><Link href={`/ventas/${v.id}`} style={{ color: '#1c9764' }}>{v.numero}</Link></td>
                <td style={celda}>{v.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td>
                <td style={celda}>{v.cliente}</td><td style={celda}>{ETIQUETAS[v.comprobante] ?? v.comprobante}{v.estado === 'anulada' ? ' (anulada)' : ''}</td>
                <td style={celda}>{v.cobro}</td><td style={celda}>{v.comprobante === 'nota_credito' ? '−' : ''}{formatearPesos(aCentavos(v.total))}</td>
                <td style={{ ...celda, whiteSpace: 'nowrap' }}>
                  {v.estado === 'cerrada' && v.comprobante !== 'nota_credito' && <Link href={`/ventas/nueva?editar=${v.id}`} style={{ color: '#1c9764', marginRight: 10 }}>Editar</Link>}
                  <a href={`/comprobante/ventas/${v.id}`} target="_blank" rel="noopener" style={{ color: '#1c9764' }}>Compartir</a>
                </td>
              </tr>
            ))}
            {ventas.length === 0 && (<tr><td style={celda} colSpan={7}>Todavía no hay ventas.</td></tr>)}
          </tbody>
        </table>
        {!p.q && !p.todas && ventas.length >= 10 && (<Link href="/ventas?todas=1" style={{ color: '#1c9764' }}>Mostrar más</Link>)}
      </div>
    </main>
  );
}
