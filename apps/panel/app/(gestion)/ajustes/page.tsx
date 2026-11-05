import Link from 'next/link';
import { tarjeta } from '../../../lib/estilos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { puede, type Rol } from '../../../../../packages/seguridad/src/index.ts';

export const dynamic = 'force-dynamic';

export default async function Ajustes() {
  const s = await sesionObligatoria();
  const u = { rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: null };
  const enlace = { color: '#1c9764', fontWeight: 600 as const, textDecoration: 'none' };
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Ajustes</h1>
      {puede(u, 'permisos') && <div style={tarjeta}><Link href="/ajustes/usuarios" style={enlace}>Usuarios y permisos</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Quién usa el sistema, qué puede hacer, qué cajas ve y su PIN de mostrador.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/empresa" style={enlace}>Empresa y marca</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Datos fiscales, logo y color que salen en listas de precios y comprobantes.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/cajas" style={enlace}>Cajas</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Crear, ordenar y archivar cajas.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/medios" style={enlace}>Medios de pago</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Efectivo, tarjetas, transferencias: sus cajas y comisiones.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/rubros" style={enlace}>Rubros</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Agregar y ordenar los rubros de los productos.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/extras" style={enlace}>Datos extras</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Datos propios de tus productos (marca, origen…) y sus valores.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/costos-fijos" style={enlace}>Costos fijos</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Alquiler, luz, personal… repartidos en el costo de lo que se elabora.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/masiva" style={enlace}>Modificación masiva de costos</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Subir o bajar costos de muchos productos a la vez.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/importar" style={enlace}>Importar</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Cargar clientes, proveedores o productos desde un archivo, con vista previa antes de confirmar.</div></div>}
      {puede(u, 'ajustes') && <div style={tarjeta}><Link href="/ajustes/correo" style={enlace}>Correo</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Conectar tu Gmail u Outlook para enviar comprobantes por mail.</div></div>}
      <div style={tarjeta}><Link href="/cuenta" style={enlace}>Mi cuenta</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Cambiar tu contraseña o tu PIN.</div></div>
      <div style={tarjeta}><Link href="/operador" style={enlace}>Cambiar de operador</Link><div style={{ fontSize: 13, color: '#5c6d66' }}>Pasar el mostrador a otra persona con su PIN.</div></div>
    </main>
  );
}
