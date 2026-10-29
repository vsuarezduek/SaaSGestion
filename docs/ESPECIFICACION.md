# Especificación funcional

Extraída del prototipo `prototipo/mistica.html`, construido con Mística Natural. Describe **qué hace** el sistema y **qué reglas aplica**. Lo marcado **(núcleo)** es obligatorio para la paridad de la etapa 1. Lo marcado **(config)** es algo que en el sistema real debe ser configurable por comercio y no estar fijo en el código. Lo marcado **(pendiente)** no existía aún en el prototipo.

## 1. Convenciones generales

- Idioma: español (Argentina). Moneda: pesos. Formato `$ 1.234`. Decimales con coma al exportar a CSV.
- Los **saldos se calculan** sumando movimientos; no se guardan como número editable.
- Cuenta corriente: **saldo positivo = el cliente nos debe / nosotros debemos al proveedor**; negativo = saldo a favor.
- Cada operación registra **usuario y fecha/hora**.
- Todas las listas largas son **desplegables, cerradas por defecto**, y muestran "mostrar 10 más / todas".
- Los buscadores encuentran por **partes del texto en cualquier orden**, sin importar mayúsculas ni tildes; singular y plural equivalentes.
- Marca visual (logo y colores) por comercio. **(config)**

## 2. Usuarios, roles y permisos (núcleo)

- Tipos de usuario: Administrador, Encargada, Atención al público, Cocina, Marketing. **(config)**
- Todos acceden por defecto a: Ventas, Clientes, Proveedores, Compras, Cajas, Productos.
- El administrador otorga permisos adicionales: Ajustes, Informes, Descargar (exportar), Cambiar permisos.
- Cada usuario ve solo las **cajas habilitadas** para él (el administrador ve todas).
- Solo el administrador usa contraseña; los demás operadores cambian de usuario sin clave (selector). **(config)** En el sistema real: inicio de sesión seguro + PIN de mostrador.
- Inicio muestra fecha, usuario operando, sesión anterior y botón de cerrar sesión.
- La sesión se mantiene abierta al reabrir.
- Informe de actividad por usuario (ventas y movimientos), visible para el administrador.

## 3. Inicio (núcleo)

- Tarjetas: ventas de hoy, ticket promedio de hoy, sesión anterior.
- **Pedidos de clientes** pendientes (desplegable; cada pedido se puede editar, abrir el cliente o convertir en venta).
- **Mercadería a pedir** agrupada por proveedor, con casilla por producto y botón "Armar compra".
- **Historial de actividad** (solo administrador): ventas, compras, notas de crédito, movimientos de caja, recibos y órdenes de pago, elaboraciones y cierres, con usuario; cada línea abre su detalle.
- Frase aleatoria (autores: Thoreau, Whitman, Hipócrates, Sócrates, Séneca, Marco Aurelio, Epicteto, Nietzsche). **(config)**

## 4. Ventas (núcleo)

Flujo: elegir cliente → tipo de comprobante → productos → cobro → cerrar.

- Cliente por búsqueda; por defecto **Consumidor Final**. Si no existe, se crea desde la venta y se abre la ficha para completar datos.
- Comprobantes: **Remito** (primero en la lista), Factura B, Factura A, Sin comprobante, Nota de crédito. **(config)**
- Encabezado editable: cliente, comprobante, fecha y hora, lista de precios (minorista/mayorista).
- Renglones: producto (búsqueda; también **ítem libre** con precio manual), cantidad decimal, precio, **descuento % por renglón**; subtotal; **descuento total %**. Los productos nuevos se agregan arriba y el cursor va a la cantidad.
- Botón **Actualizar precios** (vuelve a leer la lista vigente).
- **Medio de pago** (efectivo, transferencia, QR, link de pago, débito, crédito) y **caja** de cobro. Cada medio habilita solo ciertas cajas **(config)**: efectivo → cajas de efectivo; transferencia → banco; QR/link/débito/crédito → billetera.
- **Comisión por medio de pago** **(config)**: porcentaje + IVA sobre la comisión; se muestra "Neto a cobrar" y se registra como movimiento de caja aparte.
- **Cuenta corriente**: casilla "Dejar en cuenta corriente (se paga $0)". Solo si la categoría del cliente la tiene habilitada.
- Una sola casilla de **nota** al pie.
- Un cliente con saldo pendiente muestra el aviso al seleccionarlo.
- **Cerrar venta** genera: movimiento de caja (o de cuenta corriente), comisión, descuento de stock.
- **Dejar abierta**: guarda la venta como abierta; las ventas sin cerrar quedan **automáticamente guardadas** como abiertas. Hay "+ Nueva venta" dentro de una venta abierta.
- Pantalla inicial de Ventas: cliente, comprobante, **ventas abiertas** y **últimas 10 ventas** (clickeables).
- Venta cerrada: vista de detalle clickeable (cliente, fecha, caja, comprobante), con Editar, Eliminar, PDF y Email.
- Editar un comprobante cerrado: **revierte** sus movimientos y stock y regenera los nuevos, dejando rastro.
- **Nota de crédito** y **devolución de pago** disponibles junto a venta y recibo.
- **Guardar como pedido** (pedido de cliente pendiente).
- Facturación electrónica ARCA: en el prototipo queda marcada "pendiente".

## 5. Compras (núcleo)

Mismo esquema que ventas, con proveedor y "pagar desde" en lugar de cobrar en.

- Por defecto "actualizar costos y mantener rentabilidad". Opciones: no actualizar; actualizar costo sin tocar precio; actualizar costo y mantener utilidad.
- Categoría de la compra: mercadería, impuestos, servicios, envases, arreglos, logística, marketing, sueldos. **(config)**
- Cuenta corriente con la misma casilla que en ventas.
- **Impuesto por transacción** del banco/billetera al pagar desde una caja (ver §8).
- Compra de **faltantes**: arma la compra con los productos bajo el stock mínimo del proveedor hasta el stock ideal.
- Orden de pago al proveedor, con impuesto por transacción si corresponde.
- Últimas 10 compras y compras abiertas, igual que ventas.

## 6. Clientes y proveedores (núcleo)

- Búsqueda (por defecto solo muestra resultados al escribir); inicio muestra los últimos 10 compradores.
- Ficha editable: nombre, categoría, teléfono, mail, domicilio, localidad, CUIT, condición de IVA. En proveedores: **contacto** y **categoría** (lista desplegable con opción de nueva).
- Perfil: saldo de cuenta corriente, total comprado, ticket promedio, **top 5 productos** (clickeables), historial (clickeable), botones: + venta/compra, + nota de crédito, + recibo / orden de pago, devolución, compartir por mail o PDF, editar, eliminar (oculta; el historial se conserva).
- Proveedor: sección desplegable de **productos del proveedor**, "cargar compra de faltantes", informes.
- **Categorías de cliente (config)**: lista de precios por defecto, cuenta corriente habilitada, descuento por defecto, venta a costo.
- **Informes** (clickeables): lista de clientes por parámetro (total comprado, cantidad, ticket promedio, saldo, última compra), top 10 con selector de período, deudores. Proveedores: saldos, compras totales, últimos 30 días, cantidad de productos.

## 7. Productos (núcleo)

- Buscador, filtro por tipo de producto, rubro (con subrubros) y proveedor.
- Ficha: código, rubro, tipo de producto, proveedor, **stock actual / ideal / mínimo**, costo, utilidad y precio minorista y mayorista (editar uno recalcula el otro), IVA, unidad.
- Indicadores: disponible para venta, para compra, para integrar otros productos, **compuesto**, mostrar en la web (+ enlace).
- **Datos extras** (config): lista mayorista, grupo de compra mayorista, categoría de fracción, ferias.
- Historial de ventas y compras del producto (clickeables).
- Modificación masiva por proveedor/rubro/lista: porcentaje o importe; mantener utilidad (cambia el precio) o mantener precio (cambia la utilidad).
- Exportar e importar CSV eligiendo columnas; el import actualiza por **código** y puede crear los inexistentes.
- **Descargar listas**: por dato extra, rubro o proveedor; minorista/mayorista/ambos; opcional solo lo que hay en stock y con stock visible; **PDF con logo (principal)** y CSV.
- Informes (clickeables): top 10 más vendidos por período, productos por proveedor.
- **Compuestos y elaboración**:
  - Receta: ingredientes con cantidades para una tanda y cuánto rinde.
  - Costo por unidad = ingredientes ÷ rinde (+ costo fijo, ver §9). Botón para aplicar el costo (manteniendo utilidad o solo costo).
  - **Registrar elaboración**: cantidad que salió → suma stock del producto y descuenta ingredientes; historial y reversión.

## 8. Cajas (núcleo)

- Cajas **(config)** de ejemplo: Efectivo, Respaldo, Mercadopago, Alias Banco, Almuerzos. Tipo: efectivo (arqueo por conteo) o digital (conciliar con app/banco).
- Lista con estado (abierta / cerrada con candado) y saldo; el nombre abre el detalle.
- Detalle: movimientos (10 + "mostrar 10 más / todas"), cada uno con su venta/compra de origen clickeable, editar y eliminar (replica en caja con rastro).
- Movimiento manual (ingreso/egreso) con fecha y hora elegibles; **transferencia** entre cajas con botón "transferir todo".
- **Apertura**: se cuenta el efectivo, se compara con el saldo esperado y la diferencia queda registrada.
- **Cierre con arqueo**:
  - Resumen del turno: saldo de apertura, movimientos por medio de pago, comisiones, impuestos, compras, cobros y pagos, gastos, tickets y ticket promedio.
  - Esperado vs. contado → sobrante o faltante (se registra como movimiento).
  - **Dejar de cambio** (se recuerda) y **traspasar el resto** a otra caja.
  - Cajas digitales: se carga el saldo según app/banco.
  - Detalle del cierre con **PDF** y **mail**.
- **Historial de cierres** por caja y general.
- **Caja cerrada = bloqueada**: no admite cobros, movimientos ni transferencias; no aparece como destino de cobro. Reabrir el mismo día exige administrador y motivo. Las anulaciones sí se permiten.
- Movimientos de caja de todos los usuarios para el administrador; cada usuario ve solo los suyos.
- Impuesto por transacción **(config por caja)**: ej. Mercado Pago 0,6 %, banco 0,8 % sobre los pagos que salen de esa caja; se registra como movimiento aparte y se revierte con el comprobante.

## 9. Costos fijos y elaboración (núcleo)

- Se eligen productos que representan costos fijos (alquiler, luz, agua, gas, impuestos municipales, personal de cocina) con una cantidad cada uno.
- Total mensual ÷ producción registrada de los últimos N días (30 por defecto) → costo fijo por unidad.
- Reparto **por unidades producidas** o **por costo de ingredientes**.
- Se suma al costo de cada elaborado cuando está activado. Sin elaboraciones registradas, el costo fijo es 0.

## 10. Saldos iniciales y migración

- El prototipo importó saldos desde el sistema anterior (clientes a cobrar, proveedores a pagar) como movimientos "Saldo inicial (migración)".
- **Reglas de esa migración específicas de Mística** (no son del producto): ignorar saldos de redondeo menores a $100; excluir ciertas cuentas; no cargar saldo al propio titular.
- Sistema real: herramienta de importación reutilizable (CSV de productos, clientes, proveedores y saldos) para nuevos comercios.

## 11. Reglas de negocio (para tests)

1. El saldo de una caja es la suma de sus movimientos; no es editable.
2. Cerrar una venta con caja descuenta stock y genera movimiento de caja por el **total**; si el medio tiene comisión, genera además un movimiento negativo por la comisión (porcentaje × (1 + IVA)).
3. Cerrar una venta en cuenta corriente suma el total al saldo del cliente y **no** genera movimiento de caja. Solo se permite si la categoría del cliente tiene cuenta corriente.
4. Un recibo reduce el saldo del cliente y suma a la caja elegida; una orden de pago reduce el saldo del proveedor y resta de la caja.
5. Una nota de crédito invierte los signos de su comprobante.
6. Editar o eliminar un comprobante cerrado **revierte** movimientos de caja, de cuenta corriente y de stock, y regenera los nuevos; los movimientos originales quedan marcados como revertidos.
7. Compras con actualización de costos recalculan costo y, según el modo, precios para mantener la utilidad (nuevo precio = precio × costo nuevo ÷ costo anterior).
8. Una caja cerrada rechaza cualquier movimiento nuevo, salvo anulaciones y los asientos del propio cierre/apertura.
9. En el cierre: diferencia = contado − esperado; si ≠ 0 se registra un movimiento por esa diferencia; el traspaso = contado − cambio dejado, si hay destino.
10. El impuesto por transacción se calcula sobre el monto que sale de la caja y se revierte junto con el comprobante o la orden de pago.
11. Elaborar descuenta `cantidad_ingrediente × (cantidad_elaborada ÷ rinde)` de cada ingrediente y suma la cantidad elaborada; eliminar la elaboración lo revierte exactamente.
12. Costo fijo por unidad = total mensual ÷ Σ unidades producidas en el período (o ponderado por costo de ingredientes).
13. Descuento total % se aplica sobre (subtotal − descuentos por renglón).
14. Las ventas abiertas se guardan automáticamente y no reaparecen luego de cerrarse o eliminarse.
15. Un cliente/proveedor/producto "eliminado" se oculta pero conserva su historial.
16. **El stock puede quedar negativo** (no se bloquea la venta), pero el sistema lo **alerta**: aviso al agregar el producto a la venta, y lista de productos con stock negativo en Inicio y en Productos.

## 12. Pendiente / fuera del prototipo

- **Facturación ARCA** (el prototipo solo marca "pendiente").
- **Tienda online** integrada.
- Auditoría de cambios de productos y precios.
- Variantes (talle/color), códigos de barras, balanzas, múltiples depósitos.
- Suscripciones y alta autoservicio de comercios.
- Seguridad real (el prototipo guarda la contraseña de administrador en el código y los permisos solo ocultan pantallas).
- Alertas al cierre de caja (ventas abiertas sin cerrar, diferencias grandes).
- Integración con Tienda Nube / Mercado Libre para comercios que las usen.
