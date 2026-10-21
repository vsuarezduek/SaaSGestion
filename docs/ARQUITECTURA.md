# Arquitectura propuesta

> Documento para revisar y decidir. Las decisiones marcadas **[DECIDIR]** son las que conviene validar con el hermano programador antes de escribir código.

## 1. Objetivos que condicionan todo

1. **SaaS multi-comercio**: cualquiera se registra en saasgestion.com.ar y usa el sistema en su tienda, con datos aislados.
2. **Rubros distintos**: dietética, almacén, kiosco, ropa. Cada uno pide cosas distintas (ver §7).
3. **Tienda online integrada** al mismo stock, precios y caja. Mística la usa para dejar Tienda Nube (misticanatural.com.ar) y luego se ofrece a los demás comercios.
4. **Confiabilidad de dinero y stock**: un error contable en un cliente es un problema grave.
5. **Costo bajo al inicio**, con camino de crecimiento sin reescribir.

## 2. Mapa general

```
                 ┌────────────────────────────────────────────┐
                 │               saasgestion.com.ar           │
  Visitantes ───▶│  Sitio público + registro + suscripción    │
                 └────────────────────────────────────────────┘

  Comercio (staff)           Clientes del comercio
       │                              │
       ▼                              ▼
┌─────────────┐              ┌────────────────────┐
│  Panel de   │              │ Tienda online      │
│  gestión    │              │ (misticanatural…)  │
│  (PWA)      │              │ dominio propio     │
└──────┬──────┘              └─────────┬──────────┘
       │            API (un solo backend)
       └───────────────┬───────────────┘
                       ▼
        ┌───────────────────────────────┐
        │  Backend: reglas de negocio   │──▶ Worker (tareas en segundo plano)
        │  auth · permisos · tenant     │       · facturación ARCA
        └──────────────┬────────────────┘       · mails / PDFs
                       ▼                        · cobros y suscripciones
              PostgreSQL (RLS por tenant)       · sync con sistemas externos
                       │
              Almacenamiento de archivos (imágenes, PDFs)
```

Un único backend con todas las reglas de negocio. El panel y la tienda son clientes del mismo backend: así el stock, los precios y los pedidos nunca se desincronizan.

## 3. Stack propuesto  **[DECIDIR]**

| Capa | Propuesta | Por qué |
|---|---|---|
| Lenguaje | TypeScript en todo | Un solo lenguaje; mucha ayuda de herramientas e IA |
| Panel y tienda | Next.js (React) | Renderizado en servidor para SEO de la tienda; el panel como PWA instalable en el celular |
| Backend | Mismo proyecto Next.js (rutas de API) al inicio, con la lógica en un paquete de dominio independiente | Menos piezas al principio; si crece, se separa sin reescribir |
| Base de datos | PostgreSQL | Transacciones, Row Level Security, `numeric` para dinero |
| Acceso a datos | Drizzle o Prisma | Migraciones versionadas y tipos |
| Tareas en segundo plano | Cola sobre Postgres (p. ej. pg-boss) o Redis | Facturación, mails, sincronizaciones |
| Autenticación | Librería establecida (Auth.js / Lucia / proveedor) | No inventar seguridad |
| Archivos | Almacenamiento de objetos (Cloudflare R2 o S3) | Fotos de productos, PDFs |
| Alojamiento | Railway (app + worker + Postgres) al inicio; Vercel para la tienda si hace falta CDN | Simple y barato para empezar |
| Errores y logs | Sentry + logs del proveedor | Enterarse antes que el cliente |
| Estructura del repo | Monorepo (pnpm workspaces) | Código compartido entre panel, tienda y backend |

Estructura de carpetas sugerida:

```
apps/
  panel/        gestión (backoffice, PWA)
  tienda/       tienda online multi-comercio
  worker/       tareas en segundo plano
packages/
  dominio/      reglas de negocio (ventas, cajas, cuentas corrientes, stock, precios)
  db/           esquema, migraciones, RLS
  facturacion/  adaptadores ARCA
  ui/           componentes compartidos
docs/
prototipo/
```

## 4. Multi-comercio (tenancy)

- **Base compartida, tabla con `tenant_id`** en todo. Es lo más económico y escala bien hasta miles de comercios.
- **Row Level Security** de Postgres como segunda barrera: aunque un desarrollador olvide un filtro, la base no devuelve datos de otro tenant.
- Cada comercio tiene: subdominio (`mistica.saasgestion.com.ar`), y opcionalmente **dominio propio** para la tienda (`misticanatural.com.ar`). El backend identifica al tenant por el dominio de la solicitud.
- Datos de configuración por tenant: razón social, CUIT, condición de IVA, puntos de venta, cajas, medios de pago y comisiones, listas de precios, categorías de cliente, usuarios y permisos, rubro/plantilla.
- **Plantillas por rubro**: al registrarse, el comercio elige rubro y se precargan categorías, cajas, medios de pago y campos relevantes.

## 5. Modelo de datos (núcleo)

Principios:

- **Libros append-only** para tres cosas: movimientos de caja, cuenta corriente y stock. El saldo es la suma de movimientos. Corregir = movimiento inverso que apunta al original (así ya funciona el prototipo).
- **Comprobantes** (venta, compra, nota de crédito, recibo, orden de pago, remito) como documentos con renglones; al cerrarse, generan sus movimientos. Editar un comprobante cerrado revierte y regenera (queda trazabilidad).
- **Auditoría**: cada alta, modificación o anulación guarda usuario, fecha y valor anterior. Incluye cambios de productos y precios (el prototipo no lo hacía).

Entidades principales (resumen):

```
tenant, usuario, rol/permiso
cliente (categoría → lista de precios, descuento, cuenta corriente sí/no)
proveedor
producto ── variante (talle/color/presentación) ── código de barras
rubro (árbol)  ·  lista de precios  ·  precio (producto × lista)
deposito (sucursal/local)  ·  movimiento_stock
receta (producto compuesto → ingredientes, rinde)  ·  elaboracion
costo_fijo  ·  regla de reparto de costo fijo
comprobante + renglon  ·  numeracion por punto de venta
caja ── turno (apertura/cierre/arqueo) ── movimiento_caja
cuenta_corriente_movimiento
medio_de_pago ── comision / impuesto por transaccion (configurable)
pedido (tienda online / mostrador)  ·  carrito  ·  envio
documento_fiscal (CAE, QR, estado)  ·  suscripcion (plan, estado)
```

Decisiones de modelado que **cuesta cambiar después**, por eso van desde el inicio:

- **Variantes de producto** (talle/color): aunque Mística no las use, tiendas de ropa sí.
- **Fraccionados y unidades**: cantidades decimales, unidad de medida, equivalencias (granel ↔ envasado).
- **Depósitos / sucursales**: el stock siempre pertenece a un depósito, aunque exista uno solo.
- **Múltiples listas de precios** y precios por categoría de cliente.
- **Dinero**: `numeric(14,2)`; IVA discriminado por renglón; precios con y sin IVA según el tipo de comprobante.
- **Monedas**: el prototipo usa solo pesos; dejar el campo `moneda` previsto.

## 6. Facturación electrónica (ARCA)  **[DECIDIR]**

Es lo más delicado y lo que más pesa para vender. Se aísla detrás de una interfaz `ProveedorFacturacion`.

- Opción A, **servicio intermediario** (hay varios en Argentina que ofrecen API para emitir comprobantes): sale antes, menos riesgo, tiene costo recurrente. Recomendada para la primera etapa.
- Opción B, **integración directa** con los servicios web de ARCA (WSAA/WSFE): sin costo por comprobante, pero hay que manejar certificados por comercio, numeración, rechazos y cambios normativos.
- Requisitos de cualquier opción: CAE, QR fiscal, numeración correlativa por punto de venta, manejo de notas de crédito, entorno de homologación para pruebas, reintentos y cola.
- Los certificados y claves de cada comercio se guardan **cifrados**.
- El documento no se considera "emitido" hasta tener CAE; el estado se refleja en el comprobante (`pendiente`, `emitido`, `rechazado`).

Se recomienda empezar con A y dejar la interfaz lista para sumar B cuando haya volumen.

## 7. Tienda online integrada

Objetivo: reemplazar Tienda Nube para Mística y luego ofrecerlo a otros comercios.

- **Catálogo único**: un producto se marca como "publicado" y aparece en la tienda. Misma ficha, mismo stock, mismas imágenes.
- **Stock en vivo**: el carrito reserva stock por un tiempo; al pagar, se descuenta.
- **Pedido → venta**: un pedido online entra al mismo flujo de "pedidos de clientes" del panel; al confirmarse se convierte en venta con su comprobante, caja y comisión del medio de pago.
- **Pagos**: Mercado Pago (Checkout) como primera opción; transferencia con confirmación manual; efectivo/retiro en local.
- **Envíos**: retiro en local y envío con tarifa configurable; integración con correos/mensajería en una etapa posterior.
- **SEO**: páginas renderizadas en servidor, URLs limpias, sitemap y datos estructurados.
- **Dominio propio** por comercio con certificado automático.
- **Migración desde Tienda Nube** (Mística): exportar productos e imágenes, conservar las URLs o hacer redirecciones 301 para no perder posicionamiento, y cambiar el dominio en una ventana planificada. Mientras tanto Tienda Nube sigue funcionando en paralelo.
- **Diseño**: temas simples (colores, logo, banners) por comercio; no un constructor de páginas libre.

## 8. Suscripciones (cobrar el SaaS)

- Registro con prueba gratuita, planes por tamaño (usuarios, comprobantes, tienda online sí/no).
- Cobro recurrente con Mercado Pago (suscripciones), estados `prueba → activa → atrasada → suspendida`.
- Un comercio suspendido conserva sus datos y puede **exportarlos** (importante para la confianza).

## 9. Seguridad y operación

- Contraseñas con hash moderno; inicio de sesión con límite de intentos; recuperación por mail.
- Roles y permisos **validados en el servidor**. PIN rápido para cambiar de operador en el mostrador (reemplaza el selector de usuario del prototipo).
- Copias de seguridad automáticas de la base + copia externa periódica, y **prueba de restauración** documentada.
- Entornos separados (local, staging, producción); migraciones automáticas en el despliegue.
- Registro de auditoría consultable por el administrador del comercio.
- Cumplimiento: Ley 25.326 de protección de datos personales, términos y condiciones, política de privacidad, y facturación propia del SaaS.

## 10. Rendimiento de mostrador

El punto de venta tiene que sentirse instantáneo: búsqueda de productos por nombre parcial y código de barras con respuesta inmediata, atajos de teclado y funcionamiento tolerante a cortes breves de internet (cola local que sincroniza). La parte offline completa se deja para una etapa posterior, pero el diseño (identificadores generados en el cliente, operaciones idempotentes) lo permite.

## 11. Decisiones a validar  **[DECIDIR]**

1. ¿Next.js full-stack o backend separado (NestJS/Fastify) desde el día uno?
2. ¿Drizzle o Prisma?
3. ¿Todo en Railway o tienda en Vercel?
4. ¿Intermediario de facturación al principio? ¿Cuál?
5. ¿Autenticación propia con librería o proveedor externo?
6. ¿Aislamiento por RLS en base compartida (propuesto) o base por comercio?
7. ¿Qué rubros se priorizan después de Mística (determina variantes, balanzas, códigos de barras)?
