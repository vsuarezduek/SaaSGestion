import { listarRubros } from '../../../lib/catalogo.ts';
import { botonSecundario, campo, tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { archivarRubroAccion, renombrarRubroAccion } from './acciones.ts';
import NuevoRubro from './NuevoRubro.tsx';

export const dynamic = 'force-dynamic';

export default async function Rubros() {
  const s = await sesionObligatoria();
  const rubros = await listarRubros(s);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Rubros</h1>
      <NuevoRubro rubros={rubros.filter((r) => r.activo)} />
      <div style={tarjeta}>
        {rubros.length === 0 && <p>Todavía no hay rubros.</p>}
        {rubros.map((r) => (
          <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', paddingLeft: r.nivel * 22, opacity: r.activo ? 1 : 0.55 }}>
            <form action={renombrarRubroAccion} style={{ display: 'flex', gap: 6, flex: 1 }}>
              <input type="hidden" name="id" value={r.id} />
              <input name="nombre" defaultValue={r.nombre} style={{ ...campo, marginTop: 0 }} />
              <button type="submit" style={botonSecundario}>Renombrar</button>
            </form>
            <span style={{ fontSize: 12, color: '#5c6d66', minWidth: 70 }}>{r.productos} prod.</span>
            <form action={archivarRubroAccion}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="activo" value={String(!r.activo)} />
              <button type="submit" style={botonSecundario}>{r.activo ? 'Archivar' : 'Restaurar'}</button>
            </form>
          </div>
        ))}
      </div>
    </main>
  );
}
