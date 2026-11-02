import { formatearPesos } from '../../../../packages/dominio/src/index.ts';
import { tarjeta } from '../../lib/estilos.ts';
import { perfilDe, type TipoPersona } from '../../lib/informes.ts';
import type { SesionActiva } from '../../lib/auth.ts';

const fecha = (d: Date | null) => (d ? new Date(d).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '–');

/** Resumen de la relación con un cliente o proveedor: totales, ticket, desde cuándo y qué más compra / vende. */
export default async function PerfilPersona({ sesion, tipo, id }: { sesion: SesionActiva; tipo: TipoPersona; id: string }) {
  const p = await perfilDe(sesion, tipo, id);
  if (!p) return null;
  return (
    <div style={tarjeta}>
      <b>{tipo === 'cliente' ? 'Perfil del cliente' : 'Perfil del proveedor'}</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, margin: '8px 0', fontSize: 14 }}>
        <div><div style={{ fontSize: 12, color: '#5c6d66' }}>{tipo === 'cliente' ? 'Total comprado' : 'Total comprado a este proveedor'}</div><b>{formatearPesos(p.total)}</b></div>
        <div><div style={{ fontSize: 12, color: '#5c6d66' }}>Operaciones</div><b>{p.operaciones}</b></div>
        <div><div style={{ fontSize: 12, color: '#5c6d66' }}>Ticket promedio</div><b>{formatearPesos(p.ticketPromedio)}</b></div>
        <div><div style={{ fontSize: 12, color: '#5c6d66' }}>{tipo === 'cliente' ? 'Cliente desde' : 'Proveedor desde'}</div><b>{fecha(p.desde)}</b></div>
        <div><div style={{ fontSize: 12, color: '#5c6d66' }}>Última operación</div><b>{fecha(p.ultima)}</b></div>
      </div>
      {p.topProductos.length > 0 && (
        <div style={{ fontSize: 14 }}>
          <div style={{ fontSize: 12, color: '#5c6d66' }}>Lo que más {tipo === 'cliente' ? 'compra' : 'le comprás'}</div>
          {p.topProductos.map((t, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t.nombre}</span><span>{formatearPesos(t.monto)}</span></div>)}
        </div>
      )}
    </div>
  );
}
