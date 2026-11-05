import { listarComprasAbiertas } from '../../../lib/comprasAbiertas.ts';
import DescartarCompraAbierta from './DescartarCompraAbierta.tsx';
import Link from 'next/link';
import { listarCompras } from '../../../lib/compras.ts';
import { boton, campo, tarjeta } from '../../../lib/estilos.ts';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../lib/etiquetas.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export default async function Compras({ searchParams }: { searchParams: Promise<{ q?: string; todas?: string }> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const [compras, abiertas] = await Promise.all([listarCompras(s, { q: p.q, limite: p.todas || p.q ? 100 : 10 }), listarComprasAbiertas(s)]);
  const hora = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>Compras</h1>
        <Link href="/compras/nueva" style={{ ...boton, textDecoration: 'none' }}>+ Compra</Link>
      </div>
      <form method="get" style={{ ...tarjeta, display: 'flex', gap: 8 }}>
        <input name="q" defaultValue={p.q ?? ''} placeholder="Buscar por proveedor, número, comprobante o categoría" style={{ ...campo, marginTop: 0 }} />
        <button type="submit" style={boton}>Buscar</button>
      </form>
      {abiertas.length > 0 && (
        <div style={{ ...tarjeta, borderColor: '#f0c36b', background: '#fffaf0' }}>
          <b>Compras abiertas ({abiertas.length})</b>
          <div style={{ fontSize: 12, color: '#5c6d66', marginBottom: 6 }}>Las ven todos los usuarios: cualquiera puede continuarlas o cerrarlas.</div>
          {abiertas.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #f3e3bf' }}>
              <span style={{ flex: '1 1 220px' }}>
                <b>{a.proveedor}</b> · {a.renglones} ítem{a.renglones === 1 ? '' : 's'} · {formatearPesos(aCentavos(a.total))}
                <div style={{ fontSize: 12, color: '#5c6d66' }}>Cargada por {a.creadaPor ?? '—'} · última modificación {hora(a.modificadoEn)}{a.modificadaPor && a.modificadaPor !== a.creadaPor ? ` (${a.modificadaPor})` : ''}</div>
              </span>
              <Link href={`/compras/nueva?abierta=${a.id}`} style={{ ...boton, textDecoration: 'none' }}>Continuar</Link>
              <DescartarCompraAbierta id={a.id} />
            </div>
          ))}
        </div>
      )}
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <b>{p.q ? 'Resultados' : 'Últimas compras'}</b>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>N°</th><th style={celda}>Fecha</th><th style={celda}>Proveedor</th><th style={celda}>Comprobante</th><th style={celda}>Categoría</th><th style={celda}>Pago</th><th style={celda}>Total</th><th style={celda}></th></tr></thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id} style={{ opacity: c.estado === 'anulada' ? 0.5 : 1 }}>
                <td style={celda}><Link href={`/compras/${c.id}`} style={{ color: '#1c9764' }}>{c.numero}</Link></td>
                <td style={celda}>{c.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td>
                <td style={celda}>{c.proveedor}</td><td style={celda}>{ETIQUETAS[c.comprobante] ?? c.comprobante}{c.estado === 'anulada' ? ' (anulada)' : ''}</td>
                <td style={celda}>{c.categoria}</td><td style={celda}>{c.pago}</td><td style={celda}>{formatearPesos(aCentavos(c.total))}</td>
                <td style={celda}>{c.estado === 'cerrada' && <Link href={`/compras/nueva?editar=${c.id}`} style={{ color: '#1c9764' }}>Editar</Link>}</td>
              </tr>
            ))}
            {compras.length === 0 && (<tr><td style={celda} colSpan={8}>Todavía no hay compras.</td></tr>)}
          </tbody>
        </table>
        {!p.q && !p.todas && compras.length >= 10 && (<Link href="/compras?todas=1" style={{ color: '#1c9764' }}>Mostrar más</Link>)}
      </div>
    </main>
  );
}
