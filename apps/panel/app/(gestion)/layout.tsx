import Link from 'next/link';
import type { ReactNode } from 'react';
import { sesionObligatoria } from '../../lib/sesion.ts';

export const dynamic = 'force-dynamic';

export default async function Gestion({ children }: { children: ReactNode }) {
  const s = await sesionObligatoria();
  const enlace = { color: '#1c9764', textDecoration: 'none', fontWeight: 600 as const };
  return (
    <div>
      <nav style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 24px', background: '#fff', borderBottom: '1px solid #d3e6de' }}>
        <b style={{ fontFamily: 'Georgia, serif' }}>{s.comercio}</b>
        <Link href="/panel" style={enlace}>Inicio</Link>
        <Link href="/productos" style={enlace}>Productos</Link>
        <Link href="/ventas" style={enlace}>Ventas</Link>
        <Link href="/clientes" style={enlace}>Clientes</Link>
        <Link href="/proveedores" style={enlace}>Proveedores</Link>
        <Link href="/cajas" style={enlace}>Cajas</Link>
        <Link href="/rubros" style={enlace}>Rubros</Link>
      </nav>
      {children}
    </div>
  );
}
