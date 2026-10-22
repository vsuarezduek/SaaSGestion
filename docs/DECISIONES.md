# Registro de decisiones

Cada decisión queda con su fecha, el estado y el motivo. Si cambia, se agrega una entrada nueva; no se borra la anterior.

Estados: **Propuesta** (esperando validación) · **Aceptada** · **Reemplazada**.

## D-001 · Aislamiento entre comercios: base compartida con Row Level Security
- **Estado:** Aceptada (implementada en `0001_base.sql`, con tests en `packages/db/tests/aislamiento.sql`).
- **Decisión:** una sola base de datos; toda tabla de negocio lleva `tenant_id` y tiene una política RLS `tenant_id = app.tenant_id()` con `FORCE ROW LEVEL SECURITY`.
- **La aplicación** se conecta con el rol `app_user` (sin permiso de saltear RLS) y fija el comercio al inicio de cada transacción: `SELECT set_config('app.tenant_id', '<uuid>', true)`. Sin comercio fijado no se ve ni se escribe nada.
- **Motivo:** costo bajo, una sola migración para todos los comercios, y la base impide los cruces aunque el código tenga un error.
- **Alternativa descartada:** una base por comercio (más aislamiento, mucho más costo y trabajo de operación para empezar).

## D-002 · Usuarios por comercio
- **Estado:** Aceptada.
- **Decisión:** los usuarios pertenecen a un comercio; el email es único *dentro* del comercio. El comercio se identifica por el dominio (`mistica.saasgestion.com.ar`). Una persona con dos comercios tiene dos cuentas.
- **Motivo:** simplifica el inicio de sesión y el aislamiento. Se puede agregar una identidad global más adelante sin romper nada.
- **Roles** (administrador, encargada, atención, cocina, marketing) más permisos extra y cajas visibles, como en el prototipo. La autorización se valida en el servidor.

## D-003 · Migraciones en SQL puro, con runner propio
- **Estado:** Propuesta (para validar con el equipo técnico).
- **Decisión:** las migraciones son archivos `.sql` numerados; `scripts/db-migrar.sh` las aplica una vez cada una y **falla si una migración ya aplicada fue editada**.
- **Motivo:** RLS, triggers y funciones se escriben mejor en SQL; evita depender de un ORM para lo más delicado. El ORM/consultas tipadas (Drizzle) se suma encima para leer y escribir, no para definir el esquema.

## D-004 · Libros de solo agregado
- **Estado:** Aceptada para auditoría (implementada). Se aplica igual a caja, cuenta corriente y stock cuando se creen.
- **Decisión:** `UPDATE`, `DELETE` y `TRUNCATE` bloqueados por trigger (incluso para el dueño de la tabla) y sin permiso para el rol de la aplicación.

## D-005 · Backend dentro de Next.js, con el dominio en un paquete aparte
- **Estado:** Propuesta.
- **Motivo:** menos piezas al empezar; la lógica de negocio vive en `packages/dominio`, independiente del framework, para poder separarla sin reescribir.

## D-006 · Alojamiento inicial: Railway (aplicación, tareas y Postgres)
- **Estado:** Propuesta.
- **Motivo:** simple y de costo bajo. La tienda online puede ir a Vercel más adelante si hace falta CDN.

## D-007 · Facturación ARCA mediante intermediario al inicio
- **Estado:** Propuesta (se decide en la etapa 3, con pruebas en homologación).
