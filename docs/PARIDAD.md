# Paridad: prototipo (artefacto) vs. sistema real

Referencia: `prototipo/mistica.html` (versión 44 del artefacto, 29/10/2026). La meta de la Etapa 1 es que el sistema real haga **lo mismo que el prototipo** (ver `ESPECIFICACION.md`).
Estados: ✅ hecho · 🟡 parcial · ⬜ falta. Se actualiza en cada entrega.

> **D-033:** menú reordenado, configuración en Ajustes, Estadísticas e Informes unificados, importar con vista previa y confirmación, eliminar producto.

## Reglas de trabajo
- Cada entrega al sistema real se compara contra esta lista; al terminarla se marca lo hecho.
- Cada cambio nuevo del artefacto se agrega acá (y a `CAMBIOS-PROTOTIPO.md`) con estado ⬜ y se decide cuándo pasarlo.
- Cuando Mística pase al sistema real, el prototipo queda congelado como referencia.

## Productos
| Función | Estado | Nota |
|---|---|---|
| Pantalla Productos: buscador de entrada con resultados al escribir, acciones del prototipo, listado con filtros desplegable y ordenable | ✅ | D-040 |
| Ficha: código, rubro/subrubros, tipo, proveedor, IVA, unidad, costo y listas de precios | ✅ | Proveedor del producto: D-024 |
| Stock actual/ideal/mínimo, libro de stock, alertas (incl. negativo) | ✅ | |
| Disponible para venta/compra/integrar, web | ✅ | "Compuesto" = tiene receta (D-026) |
| **Datos extras** configurables (renombrar, agregar, quitar) y valores por producto | ✅ | D-024 |
| Datos extras: lista de productos por valor, renombrar valor, quitar valor, agregar productos | ✅ | v44 |
| **Editar el producto en la misma página** (Editar / Guardar / Cancelar) | ✅ | D-031 |
| Los datos extras se muestran al final de la página del producto | ✅ | D-041 |
| Ficha del producto como el prototipo: resumen, etiquetas, tarjetas de stock/costo/precios con utilidad, «Modificar» con barra fija Guardar/Cancelar, «Forma parte de» | ✅ | D-041 |
| Historial de ventas y compras del producto | ✅ | Desplegables en la ficha |
| Modificación masiva (por proveedor/rubro/lista, % o $) | ✅ | D-025; con vista previa |
| Exportar/importar CSV (por código, crear inexistentes) | ✅ | Importar con vista previa (D-023) y exportar con columnas elegibles (D-025) |
| Descargar listas de precios (PDF con logo y CSV) | ✅ | PDF (imprimir) con logo y CSV con filtros |
| Informes: ranking, por proveedor, **productos filtrados** (proveedor, rubro, extras, disponible para venta) | ✅ | D-031 |
| Recetas, elaboración, costos fijos | ✅ | D-026; elaborar, anular, aplicar costo |
| "Marcar para pedir" / mercadería a pedir | ✅ | D-031. Se marca a mano en la ficha y se limpia al comprarlo |

## Clientes y proveedores
| Función | Estado | Nota |
|---|---|---|
| Fichas, categorías de cliente (lista, cta. cte., descuento, venta a costo), archivar | ✅ | |
| Consumidor Final | ✅ | |
| Pantalla Clientes: buscador de entrada, alta si no encuentra, últimos 10 con operaciones, listado completo desplegable y ordenable, descargar lista | ✅ | D-038 |
| Pantalla Proveedores: igual que Clientes (buscador, alta si no encuentra, últimos 10, listado ordenable, descargar lista) | ✅ | D-039 |
| Cuenta corriente como libro de solo agregar, saldo inicial, ajustes, reversión | ✅ | |
| **Historial con saldo en cada movimiento** | ✅ | Cuenta corriente de cliente y proveedor |
| Historial: botones Editar / Agregar recibo de pago / Compartir (PDF o email) / Eliminar por venta o compra | ✅ | D-031. Editar y Compartir en cada fila; «Eliminar» = anular desde el detalle |
| Recibos de cuenta corriente (clientes) | ✅ | Anulables |
| Órdenes de pago a proveedores | ✅ | Desde la cuenta corriente del proveedor o de una compra; se anulan con inversos |
| Devolución de pago | ✅ | D-019. Solo hasta el saldo a favor; sale de una caja abierta; se anula |
| Perfil: total comprado, ticket promedio, top 5 productos; **historial arriba del ranking** | ✅ | En la ficha de cliente y de proveedor |
| Ficha de cliente y proveedor como el perfil del prototipo: datos en lectura con «Editar» en el lugar y los botones (+ Venta/Compra, NC, recibo u orden de pago, devolución, faltantes) | ✅ | D-041 |
| Proveedor: productos del proveedor, cargar compra de faltantes | ✅ | |
| Informes de clientes y proveedores (deudores, top 10, etc.) | ✅ | `/informes`, con período, «solo con saldo» y CSV |
| Saldos iniciales: herramienta de importación | ✅ | Columna Saldo en la importación de clientes y proveedores |

## Ventas
| Función | Estado | Nota |
|---|---|---|
| Venta: cliente, comprobante, fecha, lista, renglones, ítem libre, descuento por renglón | ✅ | |
| Medios de pago con cajas habilitadas y comisión; neto a cobrar | ✅ | |
| Transferencia elige automáticamente Alias Banco (primera caja preferida del medio) | ✅ | La primera caja que se tilda en el medio es la que se propone (D-030) |
| Nueva venta: buscar cliente, alta en ventana emergente si no existe, comprobante y Continuar | ✅ | D-038 |
| Cuenta corriente (solo si la categoría la permite) | ✅ | D-038: dentro de la venta, siempre visible y deshabilitada con la explicación si el cliente no la tiene |
| Cerrar venta atómico (caja, comisión, cta. cte., stock) e idempotente | ✅ | |
| Actualizar precios | ✅ | |
| Listado y detalle de venta | ✅ | D-038: «Ventas abiertas» y «Últimas 10 ventas» desplegables, columnas ordenables con un click |
| Anular venta (movimientos inversos, con motivo) | ✅ | En el prototipo "Eliminar" |
| **Descuento único**: un solo parámetro, en % o en $ total, mostrando el ajuste en $ y % | ✅ | v43–v44. Alternador % / $ total, con el ajuste en ambas unidades (D-013 ampliada) |
| Enter en precio/descuento salta a buscar otro producto | ✅ | |
| Productos nuevos arriba y cursor en cantidad | ✅ | D-041. Si el producto ya está, suma uno a su cantidad (venta y compra) |
| Editar una venta cerrada | ✅ | D-020. Anula la original y crea la nueva en una sola transacción |
| Ventas abiertas con guardado automático, "+ Nueva venta" | ✅ | Compartidas entre usuarios, con control de versión (D-016) |
| Pedidos de clientes (guardar como pedido, convertir en venta) | ✅ | D-017. Se ven en Ventas y en la ficha del cliente |
| Nota de crédito y devolución | ✅ | D-018, D-036, D-038. Desde la venta o sin venta de origen (tipo de comprobante «Nota de crédito» o «+ Nota de crédito» en la ficha del cliente) (cliente, productos y precio a mano), con devolución a caja o cuenta corriente. El comprobante electrónico es de la etapa 3 (ARCA) |
| PDF y email del comprobante (con IVA detallado) | ✅ | D-021. PDF con logo e IVA por alícuota; «Enviar por mail» abre el programa de mail con el texto (D-030). Con la casilla conectada (Ajustes → Correo, D-032) el envío es automático, con el detalle en el cuerpo y el **PDF adjunto** (D-041, pdf-lib) |
| Facturación ARCA | ⬜ | Etapa 3 |

## Compras
| Función | Estado | Nota |
|---|---|---|
| Compras, categorías, actualizar costos, faltantes, cta. cte., impuesto por transacción, editar y anular | ✅ | D-022 |
| Nueva compra: buscar proveedor, alta en ventana emergente si no existe, comprobante (incluye nota de crédito) y Continuar | ✅ | D-039 |
| Compras abiertas (borradores) | ✅ | D-035; desplegable (D-039) |
| Últimas compras desplegable, columnas ordenables con un click | ✅ | D-039 |
| Nota de crédito de proveedor | ✅ | D-036. Siempre contra cuenta corriente; baja stock y deuda, no mueve caja |

## Cajas
| Función | Estado | Nota |
|---|---|---|
| Pantalla Cajas: lista con estado y saldo, movimientos de los usuarios (filtro por usuario) e historial de cierres desplegables | ✅ | D-040 |
| Cajas, apertura con arqueo, cierre, dejar de cambio y traspaso | ✅ | |
| Configurar cajas y medios de pago desde Ajustes (crear, editar, ordenar, archivar) | ✅ | Ajustes → Cajas y medios de pago (D-030) |
| Movimientos manuales, transferencias, anulaciones, caja cerrada bloqueada | ✅ | |
| Visibilidad por usuario | ✅ | |
| Historial de cierres | ✅ | Listado y detalle de cada cierre con PDF por imprimir y «Enviar por mail» al mail de la empresa |
| Reabrir el mismo día (admin + motivo) | ✅ | D-028 |
| Impuesto por transacción por caja | ✅ | Se aplica en compras y órdenes de pago |
| Movimientos con su venta/compra de origen clickeable | ✅ | D-031 |

## Inicio, estadísticas e informes
| Función | Estado | Nota |
|---|---|---|
| Alertas de stock en el inicio | ✅ | |
| Tarjetas de ventas de hoy y ticket promedio, pedidos pendientes, mercadería a pedir | ✅ | Mercadería agrupada por proveedor, con tildes y «Armar compra»; sesión anterior |
| Inicio con fecha y hora, «Operando como» y secciones desplegables (pedidos de clientes, mercadería pendiente, alertas, historial) | ✅ | D-037 |
| Agregar mercadería fuera del catálogo al pedido pendiente | ✅ | D-041. Migración 0026; entra en «Armar compra» como ítem libre |
| Historial de actividad (administrador) | ✅ | En palabras, con enlace; requiere permiso de ajustes |
| **Estadísticas**: gráficos por día/mes, medio, usuario, día de la semana, hora, top productos/clientes, saldos | ✅ | D-027 |
| Estadísticas desplegables, con **cartel de monto al pasar el mouse**, PNG/CSV/PDF | ✅ | Cartel, CSV y PNG por gráfico (D-031); «Descargar todo en PDF», «Desplegar todo» y «Plegar todo» (D-041) |
| Frase del día | ✅ | Una por día, de estoicos célebres (Séneca, Marco Aurelio, Epicteto, Zenón) |

## Ajustes y usuarios
| Función | Estado | Nota |
|---|---|---|
| Inicio de sesión seguro, aislamiento por comercio, auditoría | ✅ | |
| Usuarios, tipos, permisos, cajas visibles: pantallas de administración | ✅ | Ajustes → Usuarios (D-029); actividad por usuario |
| PIN de mostrador / cambio de operador | ✅ | Cambiar de operador con PIN; mi cuenta (contraseña y PIN) |
| Empresa (logo, datos) | ✅ | Ajustes → Empresa y marca; logo y color en menú, lista de precios y cierre |
| Retenciones/comisiones por medio | ✅ | Medios de pago |
| Rubros | ✅ | |
| Costos fijos | ✅ | Productos → Costos fijos (D-026) |
| Botones de sección arriba en Ajustes (Empresa, Usuarios, Clientes, Rubros, Retenciones…) | ✅ | D-041 |

## Orden sugerido
> **Etapa 1 completa (D-041):** todo lo del prototipo está en el sistema real. Lo único pendiente es la facturación electrónica ARCA, que es de la etapa 3.

1. **Ventas, segunda entrega:** ✅ completa.
2. **Compras** y **órdenes de pago** (espejo de ventas y recibos).
3. **Productos:** datos extras, edición en la misma página, historial, masiva, CSV, listas, informe filtrado.
4. **Recetas, elaboración y costos fijos.**
5. **Inicio, estadísticas e informes.**
6. **Cajas:** detalle de cierres con PDF/mail, reapertura.
7. **Usuarios, permisos y PIN** (pantallas), empresa/logo.
