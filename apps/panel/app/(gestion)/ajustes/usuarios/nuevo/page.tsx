import { listarCajas } from '../../../../../lib/cajas.ts';
import { exigir } from '../../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../../lib/sesion.ts';
import FormUsuario from '../FormUsuario.tsx';

export const dynamic = 'force-dynamic';

export default async function NuevoUsuario() {
  const s = await sesionObligatoria();
  exigir(s, 'permisos');
  const cajas = await listarCajas(s);
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Nuevo usuario</h1>
      <FormUsuario inicial={{ id: null, nombre: '', email: '', rol: 'atencion', permisos: [], cajasVisibles: null, activo: true, tienePin: false, tieneContrasena: false }}
        cajas={cajas.map((k) => ({ id: k.id, nombre: k.nombre }))} esYo={false} puedeAdministradores={s.rol === 'administrador'} />
    </main>
  );
}
