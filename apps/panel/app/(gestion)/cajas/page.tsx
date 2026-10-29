import Link from 'next/link';
import { listarCajas } from '../../../lib/cajas.ts';
import { tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import NuevaCaja from './NuevaCaja.tsx';

export const dynamic = 'force-dynamic';

export default async function Cajas() {
  const s = await sesionObligatoria();
  const cajas = await listarCajas(s);
  const puedeConfigurar = s.rol === 'administrador' || s.permisos.includes('ajustes');
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>Cajas</h1>
        <Link href="/cajas/cierres" style={{ color: '#1c9764' }}>Historial de cierres</Link>
      </div>
      {puedeConfigurar && <NuevaCaja />}
      <div style={tarjeta}>
        {cajas.length === 0 && <p>Todavía no hay cajas.{puedeConfigurar ? ' Creá la primera arriba.' : ''}</p>}
        {cajas.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #d3e6de' }}>
            <Link href={`/cajas/${c.id}`} style={{ color: '#1c9764', fontWeight: 600 }}>{c.abierta ? '🔓' : '🔒'} {c.nombre}</Link>
            <span><small style={{ color: '#5c6d66' }}>{c.tipo === 'digital' ? 'digital' : 'efectivo'} · {c.abierta ? 'abierta' : 'cerrada'} · </small><b>{formatearPesos(aCentavos(c.saldo))}</b></span>
          </div>
        ))}
      </div>
    </main>
  );
}
