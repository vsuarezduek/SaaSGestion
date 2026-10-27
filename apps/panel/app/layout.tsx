import type { ReactNode } from 'react';

export const metadata = {
  title: 'SaaS Gestión',
  description: 'Software de gestión para comercios',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body style={{ margin: 0, fontFamily: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif', background: '#f0f8f5', color: '#212021' }}>
        {children}
      </body>
    </html>
  );
}
