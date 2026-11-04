# Correo: enviar comprobantes desde la casilla de cada comercio

Cada comercio conecta **su** Gmail / Google Workspace u Outlook / Microsoft 365 en **Ajustes → Correo** y desde ahí salen los comprobantes de venta y de compra (a la dirección del cliente o proveedor, editable). No se guardan contraseñas: solo un *token de renovación*, cifrado, con permiso únicamente de **enviar** (no se puede leer la casilla).

## Qué hay que configurar una sola vez (quien administra la plataforma)

Variables de entorno en Vercel (nunca en el repositorio):

| Variable | Qué es |
|---|---|
| `CORREO_CLAVE` | Clave de cifrado de 32 bytes en base64. Generar: `openssl rand -base64 32`. **Si se pierde o cambia, los comercios deben volver a conectar su casilla.** |
| `CORREO_URL_BASE` | Dirección pública de la app, sin barra final (ej. `https://app.midominio.com`). Las direcciones de retorno salen de acá. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credenciales OAuth de Google (opcionales: sin ellas no aparece el botón de Google). |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Credenciales OAuth de Microsoft (opcionales). |

Usar valores distintos en Preview/staging y en Producción.

### Google (Gmail)
1. [Google Cloud Console](https://console.cloud.google.com) → proyecto nuevo → **APIs y servicios → Biblioteca** → habilitar **Gmail API**.
2. **Pantalla de consentimiento OAuth**: tipo *Externo*, nombre de la app, mail de soporte, dominio y enlaces a política de privacidad y condiciones.
3. Permisos (scopes): `openid`, `email` y `https://www.googleapis.com/auth/gmail.send`.
4. **Credenciales → ID de cliente OAuth → Aplicación web**. URI de redirección autorizado: `<CORREO_URL_BASE>/api/correo/retorno/google`. Copiar ID y secreto.
5. **Importante:** `gmail.send` es un permiso *sensible*. Mientras la app esté en modo **Prueba**, solo funcionan las cuentas agregadas como «usuarios de prueba» (hasta 100) y **el permiso vence a los 7 días**. Para ofrecerlo a otros comercios hay que **publicar la app y pasar la verificación de Google** (puede demorar semanas; piden política de privacidad, dominio verificado y un video del uso del permiso).

### Microsoft (Outlook)
1. [Microsoft Entra](https://entra.microsoft.com) → **Registros de aplicaciones → Nuevo registro**. Cuentas admitidas: *en cualquier directorio organizativo y cuentas Microsoft personales*.
2. URI de redirección (Web): `<CORREO_URL_BASE>/api/correo/retorno/microsoft`.
3. **Permisos de API → Microsoft Graph → Delegados**: `Mail.Send`, `offline_access`, `openid`, `email`. No requiere consentimiento de administrador.
4. **Certificados y secretos → Nuevo secreto de cliente**. Copiar el *valor* (se muestra una vez). Vence como máximo a los 24 meses: anotar la fecha para renovarlo.

## Seguridad
- Solo el permiso de enviar. El token de renovación se guarda cifrado (AES-256-GCM) y atado al comercio: copiado a otro comercio no se puede abrir.
- El flujo de conexión usa un *estado* firmado, con vencimiento de 10 minutos y atado a la persona, al comercio y al navegador (cookie); sin eso se rechaza.
- Conectar y desconectar requiere el permiso de **ajustes**. Enviar lo puede hacer quien tenga acceso a ventas o compras. Desconectar revoca el permiso en Google.
- Tope de 60 mails por hora por comercio. Cada envío (y cada error) queda en un registro que solo se agrega, visible en Ajustes → Correo.
- Un envío necesita que el comprobante exista en el comercio de la sesión; los datos del mail se escapan antes de armar el HTML.

## Alcance actual
El comprobante viaja **en el cuerpo del mail** (tabla con el detalle y los totales, color y nombre del comercio). Todavía **no se adjunta un PDF**: eso requiere generar PDFs en el servidor (una dependencia nueva, a consultar). El logo tampoco va en el mail, porque Gmail y Outlook bloquean imágenes incrustadas.
