import Link from 'next/link';
import { historialDeCierres } from '../../../../lib/cajas.ts';
import { tarjeta } from '../../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';

export const dynamic = 'force-dynamic';

export default async function Cierres() {
  const s = await sesionObligatoria();
  const cierres = await historialDeCierres(s);
  const $ = (n: string) => formatearPesos(aCentavos(n));
  const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };
  const fecha = (d: Date) => d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Historial de cierres</h1>
      <div style={{ ...tarjeta, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={celda}>Cierre</th><th style={celda}>Caja</th><th style={celda}>Esperado</th><th style={celda}>Contado</th><th style={celda}>Diferencia</th><th style={celda}>Cambio</th><th style={celda}>Traspaso</th><th style={celda}>Usuario</th></tr></thead>
          <tbody>
            {cierres.map((c) => (
              <tr key={c.id}>
                <td style={celda}>{fecha(c.cerradoEn)}</td><td style={celda}><Link href={`/cajas/${c.cajaId}`} style={{ color: '#1c9764' }}>{c.caja}</Link></td>
                <td style={celda}>{$(c.esperado)}</td><td style={celda}>{$(c.contado)}</td>
                <td style={{ ...celda, color: Number(c.diferencia) < 0 ? '#b4571a' : 'inherit' }}>{$(c.diferencia)}</td>
                <td style={celda}>{$(c.cambioDejado)}</td><td style={celda}>{c.traspaso ? `${$(c.traspaso)} → ${c.destino}` : ''}</td><td style={celda}>{c.usuario ?? ''}</td>
              </tr>
            ))}
            {cierres.length === 0 && (<tr><td style={celda} colSpan={8}>Todavía no hay cierres.</td></tr>)}
          </tbody>
        </table>
      </div>
    </main>
  );
}
