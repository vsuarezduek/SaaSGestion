import Link from 'next/link';
import { listarVentas } from '../../../lib/ventas.ts';
import { ETIQUETAS_COMPROBANTE as ETIQUETAS } from '../../../lib/etiquetas.ts';
import { boton, campo, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export default async function Ventas({ searchParams }: { searchParams: Promise<{ q?: string; todas?: string }> }) {
  const p = await searchParams;
  const s = await sesionObligatoria();
  const ventas = await listarVentas(s, { q: p.q, limite: p.todas || p.q ? 100 : 10 });
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const puedeConfigurar = s.rol === 'administrador' || s.permisos.includes('ajustes');
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>Ventas</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {puedeConfigurar && <Link href="/ventas/medios" style={{ color: '#1c9764' }}>Medios de pago</Link>}
          <Link href="/ventas/nueva" style={{ ...boton, textDecoration: 'none' }}>+ Venta</Link>
        </div>
      </div>
      <form method="get" style={{ ...tarjeta, display: 'flex', gap: 8 }}>
        <input name="q" defaultValue={p.q ?? ''} placeholder="Buscar por cliente, número o comprobante" style={{ ...campo, marginTop: 0 }} />
        <button type="submit" style={boton}>Buscar</button>
      </form>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <b>{p.q ? 'Resultados' : 'Últimas ventas'}</b>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>N°</th><th style={celda}>Fecha</th><th style={celda}>Cliente</th><th style={celda}>Comprobante</th><th style={celda}>Cobro</th><th style={celda}>Total</th></tr></thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} style={{ opacity: v.estado === 'anulada' ? 0.5 : 1 }}>
                <td style={celda}><Link href={`/ventas/${v.id}`} style={{ color: '#1c9764' }}>{v.numero}</Link></td>
                <td style={celda}>{v.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td>
                <td style={celda}>{v.cliente}</td><td style={celda}>{ETIQUETAS[v.comprobante] ?? v.comprobante}{v.estado === 'anulada' ? ' (anulada)' : ''}</td>
                <td style={celda}>{v.cobro}</td><td style={celda}>{formatearPesos(aCentavos(v.total))}</td>
              </tr>
            ))}
            {ventas.length === 0 && (<tr><td style={celda} colSpan={6}>Todavía no hay ventas.</td></tr>)}
          </tbody>
        </table>
        {!p.q && !p.todas && ventas.length >= 10 && (<Link href="/ventas?todas=1" style={{ color: '#1c9764' }}>Mostrar más</Link>)}
      </div>
    </main>
  );
}
