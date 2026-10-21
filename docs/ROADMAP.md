# Hoja de ruta

Principio rector: **usar en Mística en producción antes de vender**. Cada etapa termina con algo utilizable y un criterio claro para pasar a la siguiente.

Mientras se construye el sistema real, Mística sigue operando con el prototipo (`prototipo/`) y su sistema actual. No se frena el negocio.

## Etapa 0 — Cimientos

- Repositorio, monorepo, convenciones, CI (tests y chequeos en cada Pull Request).
- Entornos: local, staging y producción en Railway; dominio saasgestion.com.ar apuntado.
- Base de datos con migraciones y Row Level Security por tenant.
- Autenticación, usuarios, roles y permisos en el servidor.
- Auditoría, manejo de errores, copias de seguridad.

**Listo cuando:** se puede crear un comercio de prueba, iniciar sesión y ver que dos comercios no se ven entre sí (con test automático).

## Etapa 1 — Núcleo de gestión (paridad con el prototipo)

Productos y rubros · clientes y proveedores · ventas y compras · cuentas corrientes · cajas (apertura, cierre, arqueo, transferencias) · comisiones e impuestos por medio de pago · listas de precios · pedidos · recetas y costos fijos · informes · exportar/importar.

Se avanza por **cortes verticales** (una función completa de punta a punta, con tests de sus reglas), no por capas.

**Listo cuando:** todo lo de `docs/ESPECIFICACION.md` marcado como "núcleo" funciona y tiene test.

## Etapa 2 — Mística en producción

- Script de **migración** desde el prototipo y el sistema actual: productos, clientes, proveedores, saldos iniciales, historial razonable.
- Uso **en paralelo** durante 2–4 semanas: se carga en ambos y se comparan cajas y saldos todos los días.
- Capacitación de usuarios, corte definitivo.

**Listo cuando:** Mística opera solo con el sistema nuevo y los cierres de caja cuadran.

## Etapa 3 — Facturación ARCA

- Proveedor de facturación elegido, entorno de homologación, emisión de Factura A/B, notas de crédito, CAE y QR, PDF.
- Estados y reintentos; reporte de comprobantes rechazados.

**Listo cuando:** Mística factura desde el sistema y contabilidad valida los comprobantes.

## Etapa 4 — Tienda online de Mística

- Catálogo público, carrito, checkout con Mercado Pago, pedidos al panel, stock en vivo.
- Dominio propio, SEO, migración desde Tienda Nube con redirecciones.
- Funcionamiento **en paralelo** con Tienda Nube hasta confirmar ventas y posicionamiento.

**Listo cuando:** se da de baja Tienda Nube sin pérdida de ventas.

## Etapa 5 — Producto para terceros

- Registro autoservicio, plantillas por rubro, asistente de configuración inicial.
- Planes y cobro de suscripción, prueba gratuita, suspensión y exportación de datos.
- Términos, privacidad, soporte (formulario/WhatsApp), ayuda dentro del sistema.
- Sitio público de saasgestion.com.ar.

## Etapa 6 — Piloto con comercios amigos

- 2–3 comercios de rubros distintos (idealmente uno de ropa y un kiosco/almacén).
- Objetivo: descubrir qué falta fuera del mundo de Mística (variantes, balanzas, códigos de barras, sucursales).
- Ajustar precio y propuesta de valor con datos reales.

## Etapa 7 — Salida comercial

- Marketing, onboarding asistido, métricas de uso y retención.
- Integraciones según demanda: Tienda Nube/Mercado Libre para quienes las usan, mensajería de envíos, contabilidad.

## Cosas que se dejan para después a propósito

- Funcionamiento offline completo del mostrador.
- App nativa (la PWA alcanza al principio).
- Multi-moneda y multi-país.
- Constructor libre de páginas para la tienda.

## Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Facturación ARCA es compleja y cambia | Intermediario al inicio, interfaz aislada, homologación obligatoria |
| Error contable en dinero/stock | Libros append-only, tests de reglas, conciliación diaria en la etapa en paralelo |
| Querer vender antes de tiempo | No pasar a etapa 5 sin etapa 2–4 cumplidas |
| Modelo de datos que no sirve a otros rubros | Variantes, depósitos y unidades previstos desde el inicio; piloto temprano |
| Depender de una sola persona | Documentación, tests y convenciones desde el día uno; hermano programador como revisor |
| Perder datos | Backups automáticos + prueba de restauración trimestral |
