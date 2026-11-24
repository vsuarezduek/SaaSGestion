import { listarComprasAbiertas } from '../../../lib/comprasAbiertas.ts';
import DescartarCompraAbierta from './DescartarCompraAbierta.tsx';
import BuscadorNuevaCompra from './BuscadorNuevaCompra.tsx';
import UltimasCompras from './UltimasCompras.tsx';
import { Seccion } from '../Orden.tsx';
import { categoriasDeProveedor } from '../../../lib/personas.ts';
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
  const [compras, abiertas, catsProv] = await Promise.all([
    listarCompras(s, { q: p.q, limite: p.todas || p.q ? 100 : 10 }), listarComprasAbiertas(s),
    categoriasDeProveedor(s).catch(() => []), // para el alta rápida de proveedor; sin permiso, va sin sugerencias
  ]);
  const hora = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Compras</h1>
      <BuscadorNuevaCompra categorias={catsProv} />
      <Seccion titulo={`Compras abiertas (${abiertas.length})`} abiertoInicial estilo={{ ...tarjeta, ...(abiertas.length ? { borderColor: '#f0c36b', background: '#fffaf0' } : {}) }}>
          {abiertas.length === 0 && <div style={{ fontSize: 13, color: '#5c6d66' }}>No hay compras abiertas.</div>}
          {abiertas.length > 0 && <div style={{ fontSize: 12, color: '#5c6d66', marginBottom: 6 }}>Las ven todos los usuarios: cualquiera puede continuarlas o cerrarlas.</div>}
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
      </Seccion>
      <form method="get" style={{ ...tarjeta, display: 'flex', gap: 8 }}>
        <input name="q" defaultValue={p.q ?? ''} placeholder="Buscar compras por proveedor, número, comprobante o categoría" style={{ ...campo, marginTop: 0 }} />
        <button type="submit" style={boton}>Buscar</button>
      </form>
      <UltimasCompras
        titulo={p.q ? 'Resultados' : p.todas ? 'Compras' : 'Últimas 10 compras'}
        abiertoInicial={Boolean(p.q || p.todas)}
        verMas={!p.q && !p.todas && compras.length >= 10}
        filas={compras.map((c) => ({
          id: c.id, numero: c.numero, fechaMs: c.fecha.getTime(), fecha: c.fecha.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
          proveedor: c.proveedor, comprobante: ETIQUETAS[c.comprobante] ?? c.comprobante, categoria: c.categoria, pago: c.pago,
          total: aCentavos(c.total), totalTexto: formatearPesos(aCentavos(c.total)), anulada: c.estado === 'anulada', editable: c.estado === 'cerrada',
        }))}
      />
    </main>
  );
}
