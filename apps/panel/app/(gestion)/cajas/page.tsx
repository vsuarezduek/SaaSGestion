import Link from 'next/link';
import { historialDeCierres, listarCajas, movimientosDeUsuarios } from '../../../lib/cajas.ts';
import { boton, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { listarUsuarios } from '../../../lib/usuarios.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import { Seccion } from '../Orden.tsx';
import MovimientosUsuarios from './MovimientosUsuarios.tsx';

export const dynamic = 'force-dynamic';

const gris = { fontSize: 12, color: '#5c6d66' } as const;
const fila = { display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #d3e6de' } as const;
const chip = (abierta: boolean) => ({ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: abierta ? '#d9f1e6' : '#eef1f0', color: abierta ? '#1c9764' : '#5c6d66', fontWeight: 600 });
const fecha = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Cajas como en el prototipo: la lista con su estado y saldo, «Movimientos de caja de los usuarios» (desplegable, abierto)
 * y el «Historial de cierres» (desplegable, cerrado).
 */
export default async function Cajas() {
  const s = await sesionObligatoria();
  const esAdmin = s.rol === 'administrador';
  const [cajas, movs, cierres, usuarios] = await Promise.all([
    listarCajas(s), movimientosDeUsuarios(s, { limite: 15 }), historialDeCierres(s, undefined, 50),
    esAdmin ? listarUsuarios(s).then((l) => l.map((u) => ({ id: u.id, nombre: u.nombre }))).catch(() => []) : Promise.resolve([]),
  ]);
  const puedeConfigurar = esAdmin || s.permisos.includes('ajustes');
  const $ = (n: string) => formatearPesos(aCentavos(n));
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Cajas</h1>
      {puedeConfigurar && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <Link href="/ajustes/cajas" style={{ ...boton, textDecoration: 'none' }}>+ Nueva caja</Link>
          <Link href="/ajustes/cajas" style={{ color: '#1c9764', fontSize: 13 }}>Configurar cajas y medios de pago</Link>
        </div>
      )}
      <div style={tarjeta}>
        {cajas.length === 0 && <p style={{ margin: 0 }}>Todavía no hay cajas.</p>}
        {cajas.map((c) => (
          <div key={c.id} style={fila}>
            <Link href={`/cajas/${c.id}`} style={{ color: '#1c9764', fontWeight: 600, fontSize: 16, flex: 1 }}>{c.nombre}</Link>
            <span style={gris}>{c.tipo === 'digital' ? 'digital' : 'efectivo'}</span>
            <span style={chip(c.abierta)}>{c.abierta ? 'Abierta' : '🔒 Cerrada'}</span>
            <b style={{ minWidth: 100, textAlign: 'right' }}>{$(c.saldo)}</b>
          </div>
        ))}
      </div>
      <MovimientosUsuarios esAdmin={esAdmin} usuarios={usuarios} inicial={movs} />
      <Seccion titulo={`Historial de cierres (${cierres.length}${cierres.length === 50 ? '+' : ''})`} estilo={tarjeta}>
        {cierres.map((c) => {
          const dif = aCentavos(c.diferencia);
          return (
            <div key={c.id} style={{ ...fila, padding: '7px 0', fontSize: 14 }}>
              <span style={{ flex: 1 }}>
                <Link href={`/cajas/cierres/${c.id}`} style={{ color: '#1c9764' }}>{fecha(c.cerradoEn)} · {c.caja}</Link>
                <div style={gris}>{c.usuario ?? '—'} · esperado {$(c.esperado)} · contado {$(c.contado)}</div>
              </span>
              <b style={{ color: dif < 0 ? '#b4571a' : dif > 0 ? '#8a6d00' : undefined }}>{dif > 0 ? '+' : ''}{$(c.diferencia)}</b>
            </div>
          );
        })}
        {cierres.length === 0 && <div style={gris}>Sin cierres</div>}
        {cierres.length > 0 && <Link href="/cajas/cierres" style={{ display: 'inline-block', marginTop: 8, color: '#1c9764', fontSize: 13 }}>Ver el historial completo en tabla →</Link>}
      </Seccion>
    </main>
  );
}
