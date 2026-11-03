import { conTenant } from '../../../lib/db.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import FormCuenta from './FormCuenta.tsx';

export const dynamic = 'force-dynamic';

export default async function Cuenta() {
  const s = await sesionObligatoria();
  const f = await conTenant(s.tenantId, async (c) => (await c.query<{ p: boolean; n: boolean }>('SELECT password_hash IS NOT NULL AS p, pin_hash IS NOT NULL AS n FROM usuarios WHERE id = $1', [s.usuarioId])).rows[0]!);
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Mi cuenta</h1>
      <p style={{ color: '#5c6d66', marginTop: 0 }}>{s.nombre}{s.email ? ` · ${s.email}` : ''}</p>
      <FormCuenta tieneContrasena={f.p} tienePin={f.n} esAdmin={s.rol === 'administrador'} />
    </main>
  );
}
