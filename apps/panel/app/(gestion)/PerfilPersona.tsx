import { formatearPesos } from '../../../../packages/dominio/src/index.ts';
import { tarjeta } from '../../lib/estilos.ts';
import type { Perfil, TipoPersona } from '../../lib/informes.ts';
import { Seccion } from './Orden.tsx';

const gris = { fontSize: 12, color: '#5c6d66' } as const;
export const fechaCorta = (d: Date | null) => (d ? new Date(d).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '');

/** Las tarjetas del perfil del prototipo: total, operaciones, ticket promedio y saldo de la cuenta corriente. */
export function TarjetasPerfil({ tipo, p, saldo, debe }: { tipo: TipoPersona; p: Perfil; saldo: string; debe: boolean }) {
  const t: [string, string, boolean?][] = [
    [tipo === 'cliente' ? 'Total comprado' : 'Total comprado a este proveedor', formatearPesos(p.total)],
    ['Operaciones', String(p.operaciones)],
    ['Ticket promedio', formatearPesos(p.ticketPromedio)],
    ['Saldo cta. cte.', saldo, debe],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
      {t.map(([r, v, w]) => (
        <div key={r} style={{ ...tarjeta, marginBottom: 0, padding: 12 }}><div style={gris}>{r}</div><div style={{ fontSize: 18, fontWeight: 700, color: w ? '#b4571a' : undefined }}>{v}</div></div>
      ))}
    </div>
  );
}

/** «Top 5 productos» del perfil, al final de la ficha como en el prototipo (desplegable). */
export function TopProductos({ tipo, p }: { tipo: TipoPersona; p: Perfil }) {
  return (
    <Seccion titulo={`Top ${p.topProductos.length || 5} productos`} estilo={tarjeta} abiertoInicial>
      <div style={gris}>Lo que más {tipo === 'cliente' ? 'compra' : 'le comprás'}, por monto.</div>
      {p.topProductos.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid #d3e6de', fontSize: 14 }}>
          <span>{i + 1}. {t.nombre}</span><b>{formatearPesos(t.monto)}</b>
        </div>
      ))}
      {p.topProductos.length === 0 && <div style={gris}>Todavía no hay operaciones.</div>}
    </Seccion>
  );
}
