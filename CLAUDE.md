# CLAUDE.md — SaaS Gestión

Contexto para trabajar en este repositorio.

## Proyecto

Software de gestión para comercios, multi-comercio (SaaS), con tienda online integrada. Se prueba primero con Mística Natural y luego se ofrece a otros rubros. Idioma del producto y de la documentación: **español (Argentina)**.

Lectura obligatoria antes de tocar código: `docs/ESPECIFICACION.md` y `docs/ARQUITECTURA.md`.
El prototipo `prototipo/mistica.html` es la referencia de comportamiento: ante la duda, el sistema real debe hacer lo mismo que el prototipo.

## Reglas que no se negocian

- **Multi-tenant**: toda tabla de negocio lleva `tenant_id`; toda consulta se filtra por tenant (y Postgres aplica Row Level Security como segunda barrera). Nunca una consulta sin tenant.
- **Dinero**: nunca `float`. Importes en `numeric(14,2)` (o enteros en centavos). Redondeo explícito y documentado.
- **Libros contables**: movimientos de caja, cuenta corriente y stock son **append-only**. Corregir = generar un movimiento inverso que referencia al original. No se hace `DELETE` ni `UPDATE` de importes.
- **Permisos en el servidor**: la interfaz solo oculta; la autorización se valida siempre en el backend.
- **Nada específico de un comercio en el código**: contraseñas, nombres de cajas, listas, porcentajes de comisión, etc. son configuración por tenant.
- **Zona horaria**: guardar en UTC, mostrar en `America/Argentina/Buenos_Aires`.
- **Secretos**: nunca en el repositorio. Variables de entorno.

## Convenciones

- TypeScript estricto. Validación de entradas con Zod.
- Migraciones de base de datos versionadas; nunca editar una migración ya aplicada.
- Cada regla de negocio con test (ver lista de reglas en `docs/ESPECIFICACION.md`, sección "Reglas de negocio").
- Commits en español, imperativo y corto. Un cambio lógico por commit.
- Ramas: `main` siempre desplegable; trabajo en ramas `feat/…`, `fix/…`; cambios por Pull Request.

## Entornos

`local` → `staging` → `produccion`. Mística opera sobre producción; los cambios se prueban antes en staging con datos de prueba, nunca con datos reales de clientes.

## Qué NO hacer sin consultar

- Cambiar el modelo de datos de dinero, stock o cuenta corriente.
- Borrar datos o migraciones.
- Agregar dependencias pesadas o servicios de pago.
- Tocar la integración de facturación (ARCA) sin pruebas en el ambiente de homologación.
