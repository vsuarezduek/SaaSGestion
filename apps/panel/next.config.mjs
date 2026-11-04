/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  // Permite importar el paquete compartido packages/seguridad (fuera de apps/panel).
  // El logo puede pesar hasta 1 MB; la subida lleva un poco más (formulario), así que el tope de las acciones se sube a 2 MB.
  experimental: { externalDir: true, serverActions: { bodySizeLimit: '2mb' } },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
