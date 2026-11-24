'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SeccionAjustes { href: string; texto: string }

/** Botones de sección arriba de Ajustes, como el prototipo (Empresa, Usuarios, Clientes, Rubros, Retenciones…): la activa en verde. */
export default function Secciones({ secciones }: { secciones: SeccionAjustes[] }) {
  const ruta = usePathname();
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 900, margin: '0 auto', padding: '16px 24px 0' }}>
      {secciones.map((s) => {
        const activa = s.href === '/ajustes' ? ruta === '/ajustes' : ruta === s.href || ruta.startsWith(s.href + '/');
        return (
          <Link key={s.href} href={s.href} aria-current={activa ? 'page' : undefined}
            style={{ border: activa ? 0 : '1px solid #d3e6de', borderRadius: 8, padding: '7px 12px', fontSize: 14, fontWeight: activa ? 700 : 500, textDecoration: 'none', background: activa ? '#1c9764' : '#fff', color: activa ? '#fff' : '#1c9764' }}>
            {s.texto}
          </Link>
        );
      })}
    </div>
  );
}
