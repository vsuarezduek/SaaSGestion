# SaaS Gestión

Software de gestión para comercios (almacenes, dietéticas, tiendas de ropa, kioscos…) con tienda online integrada.
Dominio: **saasgestion.com.ar**

Primer cliente y banco de pruebas: **Mística Natural** (dietética / alimento y medicina, Mendoza).

## Qué es

Un sistema único, en la nube, donde cada comercio se registra, configura su negocio y gestiona:

- Ventas, compras, clientes, proveedores y cuentas corrientes
- Cajas (efectivo, banco, billeteras) con apertura, cierre y arqueo
- Productos, stock, listas de precios, recetas y costos
- Facturación electrónica (ARCA)
- **Tienda online propia** (reemplaza a Tienda Nube), conectada al mismo stock y a la misma caja

## Estado

| Etapa | Estado |
|---|---|
| Prototipo funcional (un solo archivo HTML, datos de Mística) | Hecho — ver `prototipo/` |
| Especificación funcional | Hecha — `docs/ESPECIFICACION.md` |
| Arquitectura y decisiones | Propuesta — `docs/ARQUITECTURA.md` |
| Hoja de ruta | Propuesta — `docs/ROADMAP.md` |
| Sistema real (backend + base de datos) | Por empezar |

## Documentos

- [`docs/ESPECIFICACION.md`](docs/ESPECIFICACION.md): qué hace el sistema y qué reglas de negocio aplica (extraído del prototipo).
- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md): cómo se construye, por qué, y qué decisiones hay que validar.
- [`docs/ROADMAP.md`](docs/ROADMAP.md): etapas, orden y criterios para avanzar.
- [`CLAUDE.md`](CLAUDE.md): convenciones del proyecto para trabajar con Claude Code.
- [`prototipo/mistica.html`](prototipo/mistica.html): prototipo ejecutable. Es la referencia viva de comportamiento.

## Principios

1. Cada comercio es un **tenant** aislado desde el primer día.
2. El dinero y el stock son **libros contables** (solo se agregan movimientos; lo erróneo se revierte, no se borra).
3. Lo específico de un comercio es **configuración**, nunca código.
4. Primero se usa en Mística en producción; recién después se vende.
