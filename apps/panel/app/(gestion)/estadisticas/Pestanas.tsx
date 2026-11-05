import Link from 'next/link';
import { botonSecundario } from '../../../lib/estilos.ts';

const PESTANAS = [
  ['graficos', 'Gráficos', '/estadisticas'],
  ['cliente', 'Clientes', '/estadisticas/personas?tipo=cliente'],
  ['proveedor', 'Proveedores', '/estadisticas/personas?tipo=proveedor'],
  ['productos', 'Productos', '/estadisticas/productos'],
] as const;

/** Una sola sección «Estadísticas»: los gráficos y los informes por cliente, proveedor y producto. */
export default function Pestanas({ activa }: { activa: 'graficos' | 'cliente' | 'proveedor' | 'productos' }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {PESTANAS.map(([clave, texto, href]) => (
        <Link key={clave} href={href} style={{ ...botonSecundario, textDecoration: 'none', padding: '6px 12px', ...(clave === activa ? { background: '#1c9764', color: '#fff' } : {}) }}>{texto}</Link>
      ))}
    </div>
  );
}
