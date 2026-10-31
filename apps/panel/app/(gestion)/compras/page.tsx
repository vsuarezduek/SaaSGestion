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
  const compras = await listarCompras(s, { q: p.q, limite: p.todas || p.q ? 100 : 10 });
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
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <b>{p.q ? 'Resultados' : 'Últimas compras'}</b>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>N°</th><th style={celda}>Fecha</th><th style={celda}>Proveedor</th><th style={celda}>Comprobante</th><th style={celda}>Categoría</th><th style={celda}>Pago</th><th style={celda}>Total</th></tr></thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id} style={{ opacity: c.estado === 'anulada' ? 0.5 : 1 }}>
                <td style={celda}><Link href={`/compras/${c.id}`} style={{ color: '#1c9764' }}>{c.numero}</Link></td>
                <td style={celda}>{c.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td>
                <td style={celda}>{c.proveedor}</td><td style={celda}>{ETIQUETAS[c.comprobante] ?? c.comprobante}{c.estado === 'anulada' ? ' (anulada)' : ''}</td>
                <td style={celda}>{c.categoria}</td><td style={celda}>{c.pago}</td><td style={celda}>{formatearPesos(aCentavos(c.total))}</td>
              </tr>
            ))}
            {compras.length === 0 && (<tr><td style={celda} colSpan={7}>Todavía no hay compras.</td></tr>)}
          </tbody>
        </table>
        {!p.q && !p.todas && compras.length >= 10 && (<Link href="/compras?todas=1" style={{ color: '#1c9764' }}>Mostrar más</Link>)}
      </div>
    </main>
  );
}
