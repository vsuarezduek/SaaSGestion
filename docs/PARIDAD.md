# Paridad: prototipo (artefacto) vs. sistema real

Referencia: `prototipo/mistica.html` (versión 44 del artefacto, 29/10/2026). La meta de la Etapa 1 es que el sistema real haga **lo mismo que el prototipo** (ver `ESPECIFICACION.md`).
Estados: ✅ hecho · 🟡 parcial · ⬜ falta. Se actualiza en cada entrega.

## Reglas de trabajo
- Cada entrega al sistema real se compara contra esta lista; al terminarla se marca lo hecho.
- Cada cambio nuevo del artefacto se agrega acá (y a `CAMBIOS-PROTOTIPO.md`) con estado ⬜ y se decide cuándo pasarlo.
- Cuando Mística pase al sistema real, el prototipo queda congelado como referencia.

## Productos
| Función | Estado | Nota |
|---|---|---|
| Ficha: código, rubro/subrubros, tipo, proveedor, IVA, unidad, costo y listas de precios | ✅ | |
| Stock actual/ideal/mínimo, libro de stock, alertas (incl. negativo) | ✅ | |
| Disponible para venta/compra/integrar, web | 🟡 | Hay vendible/comprable/integrable/web; falta "compuesto" con receta |
| **Datos extras** configurables (renombrar, agregar, quitar) y valores por producto | ⬜ | Cambio del prototipo v42–v44 |
| Datos extras: lista de productos por valor, renombrar valor, quitar valor, agregar productos | ⬜ | v44 |
| **Editar el producto en la misma página** (Guardar/Cancelar) | ⬜ | v43 (hoy la ficha del sistema real es un formulario aparte) |
| Los datos extras se muestran al final de la página del producto | ⬜ | v43 |
| Historial de ventas y compras del producto | ⬜ | |
| Modificación masiva (por proveedor/rubro/lista, % o $) | ⬜ | |
| Exportar/importar CSV (por código, crear inexistentes) | ⬜ | Incluye columnas de datos extras |
| Descargar listas de precios (PDF con logo y CSV) | ⬜ | |
| Informes: ranking, por proveedor, **productos filtrados** (proveedor, rubro, extras, disponible para venta) | ⬜ | Filtrados: v42 |
| Recetas, elaboración, costos fijos | ⬜ | |
| "Marcar para pedir" / mercadería a pedir | ⬜ | |

## Clientes y proveedores
| Función | Estado | Nota |
|---|---|---|
| Fichas, categorías de cliente (lista, cta. cte., descuento, venta a costo), archivar | ✅ | |
| Consumidor Final | ✅ | |
| Cuenta corriente como libro de solo agregar, saldo inicial, ajustes, reversión | ✅ | |
| **Historial con saldo en cada movimiento** | ✅ | Cuenta corriente de cliente y proveedor |
| Historial: botones Editar / Agregar recibo de pago / Compartir (PDF o email) / Eliminar por venta o compra | 🟡 | Hay "Agregar recibo de pago" y enlace a la venta; "Eliminar" = anular desde el detalle; falta Editar y Compartir |
| Recibos de cuenta corriente (clientes) | ✅ | Anulables |
| Órdenes de pago a proveedores | ⬜ | Con Compras |
| Devolución de pago | ⬜ | |
| Perfil: total comprado, ticket promedio, top 5 productos; **historial arriba del ranking** | ⬜ | v42 |
| Proveedor: productos del proveedor, cargar compra de faltantes | ⬜ | |
| Informes de clientes y proveedores (deudores, top 10, etc.) | ⬜ | |
| Saldos iniciales: herramienta de importación | ⬜ | Etapa 2 |

## Ventas
| Función | Estado | Nota |
|---|---|---|
| Venta: cliente, comprobante, fecha, lista, renglones, ítem libre, descuento por renglón | ✅ | |
| Medios de pago con cajas habilitadas y comisión; neto a cobrar | ✅ | |
| Transferencia elige automáticamente Alias Banco (primera caja preferida del medio) | ⬜ | v42; en el real depende de la configuración del medio |
| Cuenta corriente (solo si la categoría la permite) | ✅ | |
| Cerrar venta atómico (caja, comisión, cta. cte., stock) e idempotente | ✅ | |
| Actualizar precios | ✅ | |
| Listado y detalle de venta | ✅ | |
| Anular venta (movimientos inversos, con motivo) | ✅ | En el prototipo "Eliminar" |
| **Descuento único**: un solo parámetro, en % o en $ total, mostrando el ajuste en $ y % | ⬜ | v43–v44. Hoy el sistema real tiene solo "descuento total %" |
| Enter en precio/descuento salta a buscar otro producto | ⬜ | v42 |
| Productos nuevos arriba y cursor en cantidad | 🟡 | Verificar |
| Editar una venta cerrada | ⬜ | En el sistema real: anular + cargar la corregida precargada |
| Ventas abiertas con guardado automático, "+ Nueva venta" | ⬜ | |
| Pedidos de clientes (guardar como pedido, convertir en venta) | ⬜ | |
| Nota de crédito y devolución | ⬜ | |
| PDF y email del comprobante (con IVA detallado) | ⬜ | |
| Facturación ARCA | ⬜ | Etapa 3 |

## Compras
| Función | Estado | Nota |
|---|---|---|
| Todo el módulo (compras, categorías, actualizar costos, faltantes, cta. cte., impuesto por transacción, abiertas) | ⬜ | Espejo de Ventas |

## Cajas
| Función | Estado | Nota |
|---|---|---|
| Cajas, apertura con arqueo, cierre, dejar de cambio y traspaso | ✅ | |
| Movimientos manuales, transferencias, anulaciones, caja cerrada bloqueada | ✅ | |
| Visibilidad por usuario | ✅ | |
| Historial de cierres | 🟡 | Hay listado; falta el detalle con PDF y mail |
| Reabrir el mismo día (admin + motivo) | ⬜ | |
| Impuesto por transacción por caja | 🟡 | Se configura; se aplica con Compras/pagos |
| Movimientos con su venta/compra de origen clickeable | 🟡 | Verificar enlaces |

## Inicio, estadísticas e informes
| Función | Estado | Nota |
|---|---|---|
| Alertas de stock en el inicio | ✅ | |
| Tarjetas de ventas de hoy y ticket promedio, pedidos pendientes, mercadería a pedir | ⬜ | |
| Historial de actividad (administrador) | ⬜ | |
| **Estadísticas**: gráficos por día/mes, medio, usuario, día de la semana, hora, top productos/clientes, saldos | ⬜ | |
| Estadísticas desplegables, con **cartel de monto al pasar el mouse**, PNG/CSV/PDF | ⬜ | v42–v44 |
| Frase del día | ⬜ | Configurable por comercio |

## Ajustes y usuarios
| Función | Estado | Nota |
|---|---|---|
| Inicio de sesión seguro, aislamiento por comercio, auditoría | ✅ | |
| Usuarios, tipos, permisos, cajas visibles: pantallas de administración | ⬜ | Hay modelo y permisos en el servidor |
| PIN de mostrador / cambio de operador | ⬜ | |
| Empresa (logo, datos) | ⬜ | |
| Retenciones/comisiones por medio | ✅ | Medios de pago |
| Rubros | ✅ | |
| Costos fijos | ⬜ | |

## Orden sugerido
1. **Ventas, segunda entrega:** nota de crédito/devolución, ventas abiertas con guardado automático, pedidos, descuento único, Enter entre campos, PDF/email, "editar" por anular y recargar.
2. **Compras** y **órdenes de pago** (espejo de ventas y recibos).
3. **Productos:** datos extras, edición en la misma página, historial, masiva, CSV, listas, informe filtrado.
4. **Recetas, elaboración y costos fijos.**
5. **Inicio, estadísticas e informes.**
6. **Cajas:** detalle de cierres con PDF/mail, reapertura.
7. **Usuarios, permisos y PIN** (pantallas), empresa/logo.
