# Panel (apps/panel)

Aplicación Next.js (panel de gestión; luego la tienda). En esta etapa solo tiene la página de inicio y `/diagnostico`.

## Vercel

- **Root Directory:** `apps/panel` (Settings → General → Root Directory). Dejar activado "Include source files outside of the Root Directory".
- **Build Command:** el del `package.json` (`vercel-build`): aplica las migraciones a la base de staging y compila. En Production no aplica migraciones.
- **Variables (como Secret):** `DATABASE_URL_STAGING` (Preview y Development) y `DATABASE_URL` (solo Production).

## Local

```
cp ../../.env.example .env   # ajustar DATABASE_URL_LOCAL
npm install
npm run db:migrar
npm run dev
```

`/diagnostico` verifica la conexión y el aislamiento por comercio; en producción responde 404.
