import { exigir } from '../../../../lib/permisos.ts';
import { obtenerEmpresa } from '../../../../lib/empresa.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import FormEmpresa from './FormEmpresa.tsx';

export const dynamic = 'force-dynamic';

export default async function Empresa() {
  const s = await sesionObligatoria();
  exigir(s, 'ajustes');
  const e = await obtenerEmpresa(s);
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Empresa y marca</h1>
      <FormEmpresa tieneLogo={e.tieneLogo} inicial={{ nombre: e.nombre, razonSocial: e.razonSocial ?? '', cuit: e.cuit ?? '', condicionIva: e.condicionIva ?? '', domicilio: e.domicilio ?? '', localidad: e.localidad ?? '', telefono: e.telefono ?? '', email: e.email ?? '', web: e.web ?? '', color: e.color }} />
    </main>
  );
}
