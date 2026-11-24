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
- **Estado:** Reemplazada por D-009 (Railway no aceptaba cuentas nuevas).
- **Motivo:** simple y de costo bajo. La tienda online puede ir a Vercel más adelante si hace falta CDN.

## D-007 · Facturación ARCA mediante intermediario al inicio
- **Estado:** Propuesta (se decide en la etapa 3, con pruebas en homologación).

## D-008 · Contraseñas con scrypt (incluido en Node) y sesiones con token hasheado
- **Estado:** Propuesta.
- **Decisión:** contraseñas y PIN con scrypt (N=2^15, r=8, p=1, sal aleatoria de 16 bytes, parámetros guardados junto al hash para poder subirlos después). Las sesiones usan un token aleatorio de 256 bits en cookie HttpOnly; la base guarda solo su sha256. Duración de sesión: 12 horas.
- **Motivo:** sin dependencias externas para lo más sensible, algoritmo aprobado por OWASP, y totalmente testeable. Si se prefiere argon2id, el formato versionado del hash permite migrar.
- **Pendiente para el inicio de sesión:** límite de intentos por usuario/IP y registro en auditoría de los ingresos fallidos.

## D-009 · Alojamiento inicial: Vercel (aplicación) + Neon (Postgres)
- **Estado:** Aceptada para la etapa 0.
- **Decisión:** la aplicación Next.js corre en Vercel (región São Paulo) y la base es Postgres en Neon (São Paulo). Dos ramas de Neon: `main` reservada para producción y `staging` para pruebas, solo con datos de prueba. La aplicación elige la base según el entorno: Production usa `DATABASE_URL`; cualquier otro entorno usa `DATABASE_URL_STAGING`, sin plan B (D-001 a D-008 siguen vigentes).
- **Aislamiento:** la aplicación se conecta como dueño y dentro de cada transacción ejecuta `SET LOCAL ROLE app_user` y fija el comercio, para que Row Level Security aplique siempre (migración 0002).
- **Migraciones:** en Preview se aplican en cada compilación; en Production se aplican a mano.
- **Costo:** planes gratuitos mientras sea desarrollo. Vercel Hobby no permite uso comercial: antes de operar a Mística sobre el sistema real hay que pasar a un plan pago y tener copias de seguridad de la base.
- **Pendiente:** tareas en segundo plano (facturación, mails) con tareas programadas de Vercel o un servicio aparte; las ramas de Neon que vencen solas no sirven para staging (se crea sin vencimiento).

## D-010 · Catálogo de productos: listas de precios configurables y sin stock todavía
- **Estado:** Aceptada para la etapa 1.
- **Decisión:** los rubros forman un árbol; las listas de precios son configuración de cada comercio (al primer uso se crean Minorista y Mayorista, y se pueden renombrar o agregar). Cada producto tiene costo sin IVA, alícuota (0 / 10,5 / 21 / 27) y un precio por lista con IVA incluido. Los productos y rubros no se borran: se archivan (regla 15) y toda alta/modificación/archivo queda en auditoría con el antes y el después.
- **Dinero:** `numeric(14,2)` en la base; los cálculos de utilidad y precio se hacen en centavos enteros con redondeo half-up (`packages/dominio`).
- **Búsqueda:** sin tildes, sin mayúsculas, sin importar el orden de las palabras y con singular/plural (`unaccent` + términos).
- **Stock:** queda fuera de esta migración a propósito. Será un libro append-only propio (movimientos con referencia al original) y se define con el usuario antes de implementarlo.

## D-011 · Stock como libro de solo agregar, con negativo permitido
- **Estado:** Aceptada para la etapa 1 (regla confirmada por el usuario: el stock puede quedar negativo, pero se alerta).
- **Decisión:** el stock actual de un producto es la suma de `stock_movimientos` (cantidad con hasta 3 decimales; + entra, − sale). No se guarda como número editable. Corregir = movimiento de reversión que referencia al original, una sola vez. Cada producto tiene stock mínimo (alerta) e ideal (para armar compras).
- **Alertas:** productos con stock negativo o bajo el mínimo se marcan en la lista de productos y en Inicio. El aviso al agregar el producto a una venta se implementa con Ventas.
- **Pendiente:** los movimientos por ventas, compras y elaboración se agregan como nuevos tipos cuando existan esos módulos (cada uno en su migración).

## D-012 · Cajas: turnos y libro de movimientos de solo agregar
- **Estado:** Aceptada para la etapa 1.
- **Decisión:** el saldo de una caja es la suma de sus movimientos. Cada caja tiene turnos: se abre contando el efectivo (la diferencia contra lo esperado queda como movimiento) y se cierra con arqueo (esperado vs. contado, diferencia registrada, cambio que se deja y traspaso del resto a otra caja abierta). Una caja cerrada rechaza cualquier movimiento nuevo (lo garantiza un trigger en la base); las anulaciones sí se permiten y generan el movimiento inverso, una sola vez. Las transferencias y traspasos son dos movimientos unidos por un grupo y se anulan juntos.
- **Visibilidad:** cada usuario ve solo las cajas habilitadas para él y solo sus propios movimientos; el administrador ve todo. Configurar cajas requiere el permiso de ajustes.
- **Pendiente:** medios de pago y comisiones (con Ventas), impuesto por transacción sobre pagos a proveedores (el porcentaje ya se configura por caja), reapertura del mismo día por un administrador con motivo, PDF y mail del cierre, resumen del turno por medio de pago.

## D-013 · Ventas: cierre atómico con medios de pago y comisión
- **Estado:** Aceptada para la etapa 1 (primera entrega de Ventas).
- **Decisión:** cerrar una venta es una sola transacción que crea la venta con sus renglones, el cobro en caja (movimiento `cobro_venta` por el total y, si el medio tiene comisión, `comision_venta` negativo aparte) o el movimiento de cuenta corriente, y un movimiento de stock `venta` por cada producto. Cada libro guarda a qué venta pertenece cada movimiento. Una venta cerrada no se edita ni se borra: solo puede pasar a anulada (trigger en la base). El número es correlativo por comercio. Una clave de idempotencia evita duplicar la venta por doble clic o reintento.
- **Cálculo:** renglón = cantidad × precio (IVA incluido) − descuento del renglón; el descuento total se reparte en cada renglón y el total es la suma de los renglones redondeados (mitad hacia arriba al centavo). El IVA de una factura es la parte incluida en cada renglón (precio × IVA ÷ (100 + IVA)) y el IVA sale del producto, no del cliente. Comisión = total × porcentaje × (1 + IVA sobre la comisión).
- **Medios de pago:** configurables por comercio, cada uno habilita solo ciertas cajas. La caja tiene que estar abierta.
- **Stock:** vender sin stock se permite; la venta avisa qué productos quedaron en negativo.
- **Pendiente (segunda entrega):** anular y editar ventas cerradas (movimientos inversos), ventas abiertas guardadas automáticamente, pedidos, nota de crédito y devolución, recibos de cuenta corriente, PDF y mail del comprobante, facturación ARCA.

## D-014 · Ventas: anulación con movimientos inversos
- **Estado:** Aceptada para la etapa 1 (segunda entrega de Ventas, parte 1).
- **Decisión:** una venta cerrada no se edita ni se borra; se anula con motivo obligatorio. La anulación genera, en una sola transacción, la reversión de cada movimiento que dejó la venta (cobro y comisión en caja, stock, cuenta corriente), cada una referenciando a su original, y marca la venta como anulada (quién, cuándo, por qué). Anular dos veces es imposible (estado y unicidad de reversiones).
- **Caja cerrada:** se puede anular igual; la reversión queda en el libro de la caja sin turno (D-012).
- **Corregir una venta:** se anula y se carga la correcta (la edición directa no existe en el modelo real).
- **Pendiente:** recibos de cuenta corriente, nota de crédito/devolución, ventas abiertas y pedidos.

## D-015 · Recibos de cuenta corriente
- **Estado:** Aceptada para la etapa 1 (segunda entrega de Ventas, parte 2).
- **Decisión:** el cliente paga su deuda con un recibo (total, parcial o de más: queda saldo a favor). Registrar un recibo es una sola transacción: el recibo (numeración correlativa propia), el ingreso en una caja abierta con un medio de pago habilitado (`cobro_recibo`, más `comision_recibo` si el medio tiene comisión) y el movimiento de cuenta corriente que baja el saldo. El saldo sigue siendo la suma del libro del cliente: el recibo puede indicar a qué venta corresponde, pero es informativo.
- **Anulación:** igual que las ventas (D-014): motivo obligatorio y movimientos inversos que referencian al original; funciona con la caja cerrada. Los movimientos que vienen de una venta o un recibo no se revierten a mano en la cuenta corriente: se anula el documento.
- **Historial:** cada movimiento de la cuenta corriente muestra el saldo que quedó después de él.
- **Pendiente:** órdenes de pago a proveedores (espejo de esto con Compras), nota de crédito/devolución, ventas abiertas y pedidos.

## D-016 · Ventas abiertas compartidas
- **Estado:** Aceptada para la etapa 1 (segunda entrega de Ventas, parte 4).
- **Decisión:** mientras se carga una venta, apenas hay un producto se guarda sola como **venta abierta** (borrador). Todos los usuarios del comercio ven y pueden continuar, cerrar o descartar las de todos: si un turno termina sin cerrar, otro la retoma. Un borrador no es un libro contable: no mueve caja, stock ni cuenta corriente; eso ocurre recién al cerrarla, que crea la venta real (D-013) y deja el borrador en estado `cerrada` con el vínculo a la venta.
- **Concurrencia:** el borrador tiene número de versión; si dos personas lo editan a la vez, la segunda recibe un aviso en vez de pisar a la primera. Al cerrar se bloquea el borrador, así que dos personas no pueden cerrar la misma venta abierta.
- **Descartar:** el borrador queda como `descartada` y en la auditoría; no se borra. Cerrado o descartado no se modifica.
- **Pendiente:** ventas abiertas de compras.

## D-017 · Pedidos de clientes
- **Estado:** Aceptada para la etapa 1 (segunda entrega de Ventas, parte 5).
- **Decisión:** un pedido es una venta abierta marcada como pedido (`es_pedido`) con fecha de entrega opcional. Se guarda desde la pantalla de venta con "Guardar como pedido" y lo ven todos los usuarios del comercio en Ventas y en la ficha del cliente (junto con sus ventas abiertas). Se ordena por entrega más próxima, los sin fecha al final; los vencidos se marcan.
- **Convertir:** "Pasar a venta / editar" abre el pedido en la pantalla de venta; al cerrarla nace la venta real (D-013) y el pedido queda `cerrado` con el vínculo. Cancelar = descartar (queda en auditoría, no se borra).
- **Por qué reutilizar la tabla:** mismo ciclo de vida, misma concurrencia (versión) y mismo bloqueo al cerrar; no mueve caja, stock ni cuenta corriente hasta ser venta. La fecha de entrega solo se admite en pedidos (restricción en base).

## D-018 · Notas de crédito (devolución de una venta)
- **Estado:** Aceptada para la etapa 1 (segunda entrega de Ventas, parte 6). Agrega tipos de movimiento a los tres libros (como D-013 y D-015): `devolucion_venta` en stock y caja, `nota_credito` en cuenta corriente.
- **Decisión:** una nota de crédito es una venta con comprobante `nota_credito`, importes en positivo, que apunta a la venta de origen (`venta_origen_id`) y cuyos renglones apuntan al renglón que devuelven. Se hace desde la venta ("Hacer nota de crédito"), eligiendo cuánto devuelve de cada producto.
- **Precios:** salen siempre de la venta original (el cliente no manda importes). Si se devuelve todo lo vendido de una sola vez, se devuelve exactamente lo cobrado; si es parcial, se aplica el porcentaje de descuento de la venta.
- **Efectos:** el stock vuelve a sumar; la plata sale de una caja abierta (sin comisión: la comisión que cobró el medio de pago no se recupera) o baja la deuda del cliente en cuenta corriente (solo si su categoría la tiene). Todo con movimientos nuevos; no se edita ni borra nada.
- **Límite:** no se puede devolver más de lo vendido, descontando devoluciones anteriores; la venta de origen se bloquea mientras se emite para que dos devoluciones simultáneas no se pasen.
- **Anular:** anular una nota genera los movimientos inversos y libera lo devuelto. Una venta con notas vigentes no se puede anular hasta anular sus notas.
- **Pendiente:** nota de crédito sin venta de origen (ítems sueltos), nota de crédito electrónica con ARCA (se hace al integrar facturación) y la devolución de pago (saldo a favor del cliente).

## D-019 · Devolución de pago
- **Estado:** Aceptada para la etapa 1. Agrega el tipo `devolucion_pago` a caja y cuenta corriente (como D-015).
- **Decisión:** cuando un cliente tiene saldo a favor (cuenta corriente negativa), se le puede devolver plata. Es el espejo del recibo: sale de una caja abierta (con un medio de pago habilitado para esa caja) y el saldo del cliente sube hacia cero. No tiene comisión.
- **Reglas:** solo hasta el saldo a favor (se bloquea al cliente para que dos devoluciones simultáneas no se pasen); el Consumidor Final no tiene cuenta corriente; la misma clave no duplica. Se anula con motivo generando los movimientos inversos; no se borra ni se edita.

## D-020 · Editar una venta cerrada
- **Estado:** Aceptada para la etapa 1.
- **Decisión:** "editar" una venta no modifica la venta cerrada (los libros son de solo agregar). Se carga la venta en el formulario y, al guardar, la original se **anula** (con sus movimientos inversos y el motivo "reemplazada por la venta N° X") y se crea una **venta nueva**, todo en una sola transacción: si algo falla, la original queda intacta.
- **Reglas:** no se editan ventas anuladas, notas de crédito ni ventas con notas de crédito vigentes (primero se anulan las notas). La venta nueva conserva la fecha original salvo que se cambie. El aviso de stock negativo se calcula con lo vendido ya devuelto al stock.

## D-021 · Comprobante imprimible / PDF
- **Estado:** Aceptada para la etapa 1.
- **Decisión:** el comprobante de una venta o nota de crédito es una página limpia (`/comprobante/ventas/[id]`) con el nombre del comercio, los renglones y, en las facturas, el neto gravado y el IVA por alícuota. El PDF sale del "Guardar como PDF" del navegador: no se agregan dependencias.
- **Pendiente:** el email del comprobante necesita un servicio de correo (proveedor, remitente y clave como variable de entorno): se decide aparte. La factura electrónica con CAE llega con la integración de ARCA.


## D-022 · Compras, órdenes de pago y costos
- **Estado:** Aceptada para la etapa 1 (migración 0014). Agrega `compra` a stock, `pago_compra`/`impuesto_compra`/`pago_orden`/`impuesto_orden` a caja y `compra`/`orden_pago` a cuenta corriente (como D-013 y D-015).
- **Decisión:** una compra es el espejo de la venta. El costo se carga **sin IVA**; el IVA se suma solo si el comprobante es factura A o B. Cerrar una compra es una sola transacción: compra, renglones, stock (+), y la salida de una caja abierta (más el impuesto por transacción de esa caja) **o** deuda en la cuenta corriente del proveedor, nunca las dos. La misma clave no duplica la compra.
- **Costos y precios:** al cerrar se elige entre no tocar nada, actualizar el costo, o actualizar costo y precio manteniendo la utilidad (precio × costo nuevo ÷ costo anterior). El costo nuevo descuenta el porcentaje del renglón. Anular una compra **no** restaura costos ni precios (pudieron cambiar después): se corrigen desde el producto.
- **Órdenes de pago:** espejo del recibo. Salen de una caja abierta (con el impuesto de esa caja), bajan la deuda con el proveedor y pueden indicar la compra que pagan (informativo: el saldo es del proveedor). Se anulan con movimientos inversos.
- **Editar/anular:** editar una compra cerrada la anula y crea otra en la misma transacción. Compras y órdenes anuladas no se modifican; no se borra nada. Los movimientos originados en un comprobante no se revierten a mano desde la cuenta corriente.
- **Pendiente:** compras abiertas (borradores), nota de crédito de proveedor.

## D-023 · Importación de listas por CSV
- **Estado:** Aceptada para la etapa 1. No cambia el modelo de datos.
- **Decisión:** clientes, proveedores y productos se importan desde un CSV (coma, punto y coma o tabulación; exportable desde Excel). Los encabezados se reconocen por nombre sin importar acentos o mayúsculas; hay plantilla descargable. Siempre hay **vista previa** (se ejecuta y se deshace) antes de importar de verdad.
- **Reglas:** se reconoce un registro existente por CUIT o nombre (personas) y por código o nombre (productos). Por defecto los existentes se omiten; con "actualizar" solo se cambia lo que el archivo trae con dato (una celda vacía no borra). El saldo y el stock inicial se cargan solo en registros nuevos, como movimientos `saldo_inicial`, para que reimportar nunca duplique. Los rubros se crean desde la ruta "A > B". Un error en una fila no frena las demás y se informa con su número. Máximo 3.000 filas por archivo. Todo queda auditado.

## Nota operativa · base de producción
La base de producción (Neon, rama `main`) está reservada y vacía a propósito: las migraciones se aplican en las vistas previas (staging). Por eso el dominio de producción muestra error hasta el lanzamiento. Las migraciones **no** se aplican a producción sin autorización expresa.

## D-024 · Proveedor del producto y datos extras
- **Estado:** Aceptada para la etapa 1 (migración 0015, aditiva). No toca dinero, stock ni cuenta corriente.
- **Decisión:** cada producto puede tener un **proveedor** (opcional). Los **datos extras** los define cada comercio (tabla `datos_extra`); el valor de cada producto se guarda en `productos.datos_extra` con el id del dato como clave. Renombrar un dato o un valor no pierde nada. «Quitar» un dato lo desactiva: los valores quedan guardados y dejan de mostrarse.
- **Uso:** se cargan en la ficha (desplegable con los valores ya usados u «Otro valor…»), se filtran en el listado, se administran por valor (agregar productos, renombrar, quitar), salen en la exportación y en las listas de precios, y se importan por CSV con el nombre del dato como encabezado. Definir datos extras requiere el permiso de ajustes.
- **Historial del producto:** la ficha muestra las ventas (con notas de crédito) y compras donde participó, con su total.

## D-025 · Modificación masiva, exportación y listas de precios
- **Estado:** Aceptada para la etapa 1.
- **Modificación masiva:** exige proveedor y/o rubro (con subrubros): nunca se aplica a todo el catálogo de una vez. Cambia el costo por porcentaje o importe (redondeo al centavo, mitad lejos del cero, nunca por debajo de cero) y, según se elija, **mantiene la utilidad** (los precios de las listas elegidas cambian en la misma proporción) o **mantiene el precio**. Primero se ve qué cambiaría; al aplicar, todo ocurre en una transacción y cada producto deja su auditoría con el antes y el después. Máximo 5.000 productos. Solo productos activos.
- **Exportar CSV:** código y nombre siempre; el resto según las columnas elegidas; requiere el permiso de descarga. Es el mismo formato que entiende la importación (D-023), que ahora también reconoce proveedor y datos extras.
- **Listas de precios:** página imprimible («Guardar como PDF» del navegador, sin dependencias) y CSV, con filtros por rubro, proveedor y dato extra, elección de listas, «solo lo que hay en stock» y «mostrar stock». Solo productos activos y vendibles. El logo del comercio llega con la configuración de empresa.

## D-026 · Recetas, elaboración y costos fijos
- **Estado:** Aceptada para la etapa 1 (migración 0016). Agrega el tipo `elaboracion` al libro de stock (como `venta` y `compra`); no toca dinero ni cuenta corriente.
- **Receta:** un producto puede tener ingredientes (otros productos) con la cantidad para una tanda y cuánto rinde la tanda; más instrucciones de texto. Un producto no puede ser ingrediente de sí mismo ni formar círculos (A usa B que usa A). Un elaborado sí puede ser ingrediente de otro.
- **Costo por unidad:** Σ (cantidad × costo del ingrediente) ÷ rinde, redondeo al centavo «mitad hacia arriba». «Aplicar costo» lo copia al producto: con «mantener utilidad» los precios de todas las listas se ajustan en la misma proporción; con «solo el costo» los precios no cambian. Todo auditado.
- **Elaboración:** una sola transacción que suma lo elaborado, resta cada ingrediente en proporción (cantidad × elaborado ÷ rinde, a la milésima) y guarda la foto de los insumos. Se permite aunque falte stock de un ingrediente (como en el prototipo), pero se avisa. La misma clave no duplica. Se anula con motivo generando los movimientos inversos; no se borra ni se edita, y sus movimientos de stock no se revierten a mano.
- **Costos fijos:** productos que representan cada costo (alquiler, luz, personal…) con una cantidad mensual; total mensual ÷ lo elaborado en los últimos N días (30 por defecto), repartido por unidades o por costo de ingredientes, y sumado al costo de la receta cuando está activado. Sin elaboraciones en el período, el costo fijo es 0. Configurarlo requiere el permiso de ajustes.

## D-027 · Inicio, estadísticas e informes
- **Estado:** Aceptada para la etapa 1. Sin migraciones: todo se calcula sobre los libros existentes.
- **Qué cuenta:** ventas cerradas (las notas de crédito restan) y compras cerradas; las anuladas no cuentan. Los días se cortan en hora de Argentina. Los importes se calculan en la base y viajan como centavos enteros.
- **Rentabilidad estimada:** precio sin IVA menos el costo **actual** del producto (no el de cuando se vendió); es una estimación y así se rotula.
- **Estadísticas:** requieren el permiso de informes. Períodos rápidos o fechas elegidas (máximo 10 años); por día hasta 62 días y por mes en adelante. Gráficos SVG dibujados en el servidor (sin dependencias), con el monto al pasar el mouse y tabla alternativa. CSV por gráfico o todo junto; PDF con imprimir del navegador.
- **Inicio:** las ventas de hoy se ven solo con permiso de informes; el historial de actividad, solo con permiso de ajustes. La mercadería a pedir sale de productos bajo el stock mínimo, agrupada por el proveedor del producto; «Armar compra» abre una compra con lo tildado.
- **Informes y perfiles:** clientes y proveedores con total, operaciones, ticket promedio, saldo y última operación del período. El perfil de la ficha usa todo el historial.
- **Frase del día:** lista fija, una por día; nada específico de un comercio. Que cada comercio configure las suyas queda pendiente.

## D-028 · Detalle de cierres y reapertura de caja
- **Estado:** Aceptada para la etapa 1 (migración 0017, aditiva: `reabre_turno_id` y `reapertura_motivo` en `caja_turnos`).
- **Detalle del cierre:** arqueo de apertura y de cierre, ingresos y egresos del turno (sin contar diferencias de arqueo ni traspasos, y sin los movimientos anulados), y cada movimiento. Versión imprimible / «Guardar como PDF» desde el navegador. El envío por mail queda pendiente hasta elegir el proveedor de correo.
- **Reapertura:** solo administración, con motivo obligatorio y solo si la caja se cerró **hoy** (hora de Argentina) y está cerrada. El turno cerrado no se modifica: se anulan con movimientos inversos (que referencian al original) la diferencia de arqueo y el traspaso que generó el cierre, en ambas cajas, y se abre un turno nuevo que continúa al anterior con el saldo resultante (el esperado del cierre). Un cierre se reabre una sola vez; si se vuelve a cerrar, se reabre el nuevo. Queda en la auditoría y a la vista en el detalle.
- **Traspaso ya gastado:** si la caja destino ya movió ese dinero, su saldo puede quedar negativo; se permite y queda a la vista, igual que cualquier otro egreso.

## D-029 · Usuarios, PIN de mostrador y empresa
- **Estado:** Aceptada para la etapa 1 (migración 0018, aditiva: tabla `empresa`).
- **Usuarios:** se administran en Ajustes con el permiso «Cambiar permisos» (el administrador lo tiene siempre). No se borran: se desactivan (se cierran sus sesiones) y siguen figurando en lo que operaron. Quien no es administrador no puede crear ni tocar administradores ni dar permisos que no tiene; nadie cambia su propio rol o permisos ni se desactiva; siempre queda al menos un administrador activo. Un administrador necesita contraseña; los demás pueden tener contraseña (con mail) y/o PIN. Poner una contraseña nueva cierra las sesiones abiertas de esa persona. Contraseñas y PIN se guardan hasheados y nunca se registran en la auditoría.
- **PIN de mostrador:** de 4 a 8 números. «Cambiar de operador» abre una sesión nueva para otro usuario activo que no sea administrador, si el PIN es correcto, y cierra la sesión anterior; los administradores solo entran con contraseña. Los intentos fallidos se cuentan por operador y por IP con el mismo límite y ventana que el ingreso (5 y 20 en 15 minutos).
- **Mi cuenta:** cada persona cambia su contraseña (pide la actual) y su PIN (pide el actual; el administrador, su contraseña).
- **Actividad por usuario:** ventas de hoy y del mes y sus últimas acciones, en la ficha del usuario.
- **Empresa:** nombre, razón social, CUIT, condición de IVA, domicilio, contacto y color de marca por comercio (requiere el permiso de ajustes; verla, no). El logo es PNG o JPG de hasta 1 MB (antes 300 KB; migración 0022), reconocido por su contenido (no por el nombre) y guardado en la base; no se acepta SVG porque puede llevar scripts. Se sirve solo a quien ingresó, con cabeceras que impiden ejecutarlo. Aparece en el menú, la lista de precios y el cierre de caja imprimible.
- **Pendiente:** el comprobante de venta todavía no lleva el logo; el color solo se usa en el menú y los encabezados impresos, no en toda la interfaz.

## D-030 · Cajas en Ajustes, marca en comprobantes y mail
- **Estado:** Aceptada para la etapa 1 (migración 0019, aditiva: `orden` en `medio_pago_cajas`).
- **Cajas y medios de pago en Ajustes:** crear, editar (nombre, tipo, impuesto por transacción), ordenar y archivar cajas. Una caja se archiva solo si está cerrada y sin saldo; no se borra, sus movimientos quedan y se puede reactivar. Los medios de pago se editan en la misma pantalla.
- **Caja preferida del medio:** el orden en que se tildan las cajas de un medio queda guardado; al cobrar con ese medio se propone la primera que esté abierta (la persona puede cambiarla).
- **Marca en los documentos:** el logo, los datos fiscales y el color cargados en Ajustes → Empresa y marca salen en el menú, el comprobante de venta, la lista de precios y el cierre de caja.
- **Frase del día:** solo estoicos célebres (Séneca, Marco Aurelio, Epicteto, Zenón), una por día. Citas con atribución tradicional; las dudosas se rotulan «atribuida».
- **Mail:** «Enviar por mail» abre el programa de mail de la persona con el mensaje escrito: el comprobante de venta va al mail del cliente con copia al mail de la empresa; el cierre de caja va al mail de la empresa. El PDF se adjunta a mano. El envío automático desde el mail de la empresa necesita credenciales de un servicio de correo (SMTP o proveedor) y queda pendiente de esa decisión.

## D-031 · Pendientes chicos: edición en página, marcar para pedir, informe de productos, PNG y enlaces
- **Estado:** Aceptada para la etapa 1 (migración 0020, aditiva: `productos.a_pedir`).
- **Ficha del producto:** se ve tal cual está y «Editar» habilita los campos; «Guardar» confirma y «Cancelar» vuelve a lo último guardado.
- **Marcar para pedir:** desde la ficha de un producto activo y comprable. Aparece en «Mercadería a pedir» aunque no esté bajo el mínimo (con cantidad mínima 1) y la marca se limpia sola al cerrar una compra que lo incluye. Queda auditado.
- **Informe de productos:** filtra por texto, rubro, proveedor, dato extra (con un valor o sin valor), si se vende, estado y alerta de stock; descarga CSV. Requiere el permiso de informes.
- **Movimientos de caja:** el concepto enlaza a la venta, recibo, devolución, compra u orden de pago de origen.
- **Estadísticas:** cada gráfico se descarga como PNG.
- **Historial:** «Editar» (ventas y compras cerradas) y «Compartir» (comprobante de venta) en cada fila.
- **Fuera de este lote, a propósito:** nota de crédito sin venta de origen, compras abiertas y nota de crédito de proveedor, porque tocan el modelo de dinero, cuenta corriente y stock (requieren consulta, según CLAUDE.md).

## D-032 · Envío de comprobantes por mail desde la casilla del comercio (OAuth)
- **Estado:** Aceptada para la etapa 1 (migración 0021, aditiva: `correo_conexion`, `correo_envios`). Elegida por el dueño entre servicio propio, SMTP por comercio y OAuth.
- **Qué hace:** cada comercio conecta su Gmail u Outlook en Ajustes → Correo; los comprobantes de venta y de compra se envían desde esa casilla, con respuesta al mail de la empresa. Sin dependencias nuevas: llamadas directas a la API de Gmail y a Microsoft Graph.
- **Seguridad:** solo permiso de enviar; token de renovación cifrado y atado al comercio; estado del flujo firmado y atado a persona y navegador; envíos auditados en un registro de solo agregar; tope de 60 por hora.
- **Requisito de puesta en marcha:** registrar la app en Google y/o Microsoft (ver `docs/CORREO.md`). Para Gmail con otros comercios, Google exige verificar la app (permiso sensible); hasta entonces solo funciona con cuentas de prueba y el permiso vence a los 7 días.
- **Límite:** el comprobante va en el cuerpo del mail, sin PDF adjunto (haría falta una dependencia de generación de PDF; se consulta antes).
- **Sin conexión:** el botón sigue abriendo el programa de mail de la persona con el texto escrito.

## D-033 · Reorganización: menú, Ajustes, Estadísticas unificada, importar con vista previa, eliminar producto
- **Estado:** Aceptada para la etapa 1 (migración 0023, aditiva: permiso `DELETE` sobre `productos` y `producto_precios`). Pedido del dueño tras probar el sistema.
- **Menú superior:** Inicio, Ventas, Clientes, Compras, Proveedores, Cajas, Productos, Estadísticas (con permiso de informes) y Ajustes. Nada más.
- **Ajustes es el centro de configuración:** usuarios, empresa y marca, cajas, medios de pago, rubros, datos extras, costos fijos, modificación masiva de costos, importar y correo. Esas pantallas pasaron de `/rubros`, `/importar`, `/productos/extras`, `/productos/costos-fijos`, `/productos/masiva` y `/ventas/medios` a `/ajustes/…`. Productos conserva solo: nuevo, descargar listas de precios, exportar e importar (enlace a Ajustes).
- **Estadísticas e Informes son una sola sección** con pestañas: Gráficos, Clientes, Proveedores y Productos (`/estadisticas`, `/estadisticas/personas`, `/estadisticas/productos`). Los permisos no cambian.
- **Importar con vista previa:** siempre se genera primero una vista previa fila por fila (se crea / se modifica con «antes → después» / se omite, más las filas con error) y recién ahí se confirma. La vista previa se calcula en una transacción que se deshace: no guarda nada.
- **Productos:** se sacó «Archivar»; «Se vende» y «Se compra» son casillas de la ficha. «Eliminar» borra solo un producto que nunca tuvo stock, ventas, compras, elaboraciones ni usos como ingrediente; con historia se rechaza con un mensaje (los libros siguen siendo de solo agregar y las claves foráneas lo impiden aunque la aplicación fallara). Queda auditado. Un producto ya archivado puede restaurarse.
- **Ventas:** el buscador de ventas se reemplazó por un buscador de cliente con selector de comprobante (remito, factura A/B, sin comprobante) que abre la venta nueva ya cargada. Se quitó la fecha de entrega del formulario de venta.
- **Cierre de venta:** si falta el medio de pago o la caja, se avisa en castellano (antes aparecía «Invalid uuid»). Lo mismo para cliente y proveedor en el resto de los formularios.
- **Pendiente de revisar con el dueño:** los permisos de las pantallas movidas siguen siendo los de siempre (en el servidor); en Ajustes se muestran a quien tiene permiso de ajustes.

## D-034 · Ventas: buscador sin listado y cuenta corriente; fichas con casilla «Modificar»
- **Estado:** Aceptada. Sin migraciones.
- **Ventas:** el buscador de cliente no lista a nadie hasta que se escribe; sin texto ofrece «Consumidor final →» para vender directo. Se puede tildar «Dejar en cuenta corriente»: si el cliente tiene cuenta corriente habilitada en su categoría, la venta abre con ese cobro elegido; si no, el buscador avisa por qué no (la regla de la categoría no cambia y el servidor la sigue exigiendo).
- **Clientes y proveedores:** la ficha va arriba y se ve de solo lectura; la casilla «Modificar» habilita los campos y muestra Guardar y Archivar. Destildarla descarta lo no guardado.

## D-035 · Compras abiertas (borradores de compra)
- **Estado:** Aceptada para la etapa 1 (migración 0024, aditiva: `compras_abiertas`). Espejo de las ventas abiertas (D-010).
- **Qué es:** una compra a medio cargar que se deja guardada («Dejar abierta») y cualquier usuario con acceso a Compras puede retomar, cerrar o descartar. Aparece en el listado de Compras. No mueve caja, stock ni cuenta corriente hasta cerrarla.
- **Reglas:** control de versión (si dos personas la tocan, la segunda se entera en vez de pisar a la primera); al cerrarla nace la compra real y el borrador queda cerrado, una sola vez aunque se intente cerrar a la vez desde dos lugares; descartar la deja registrada, nunca se borra; todo queda auditado. A diferencia de las ventas, se guarda a mano (no se guarda sola).

## D-036 · Notas de crédito: de proveedor y sin venta de origen
- **Estado:** Aceptada (decidido con el dueño). Migración 0025, aditiva: `notas_credito_compra` y sus renglones, tipos nuevos en los libros de stock (`devolucion_compra`) y de cuenta corriente (`nota_credito_compra`).
- **Nota de crédito de proveedor:** devuelve mercadería comprada. **Siempre contra cuenta corriente**: baja el stock de lo devuelto y baja lo que se le debe al proveedor; nunca mueve una caja. Comprobante propio con numeración propia; se puede referir a una compra (informativo, sin tope) o hacerse suelta desde la ficha del proveedor. El costo se carga a mano sin IVA; con nota de crédito A o B el IVA se suma encima. No se edita ni se borra: se anula con movimientos inversos que referencian a los originales. Ítems libres bajan la deuda sin tocar stock. Permiso de Compras.
- **Nota de crédito de venta sin venta de origen:** se elige cliente, productos y el precio al que se devuelve. El stock vuelve y la plata sale de una caja (sin comisión) o baja la deuda del cliente, igual que la nota con origen (comparten el mismo código de registro). No hay tope contra una venta anterior: lo controla quien la emite. Es una venta con comprobante `nota_credito` sin `venta_origen_id`; se anula como cualquier venta.
- **Sin cambios** en el modelo de dinero, stock ni cuenta corriente existentes: solo tipos nuevos de movimiento.

## D-037 · Inicio como en el prototipo: fecha y hora, y secciones desplegables
- **Estado:** Aceptada. Sin migraciones. Corrección del dueño al probar el Preview.
- **Arriba:** fecha del día y hora de Argentina (la hora se actualiza sola), «Operando como» con el nombre y el rol, y «Cerrar sesión». Debajo, tres tarjetas: sesión anterior, ventas de hoy (cantidad · monto) y ticket promedio de hoy (los montos, solo con permiso de informes).
- **Todo lo demás es desplegable y arranca cerrado**, con la cantidad en el título: «Pedidos de clientes» (lo encargado por clientes para avisar o entregar, con «+ Nuevo», productos desplegables y «Pasar a venta / editar»), «Pedido de mercadería pendiente» (bajo el mínimo y marcados para pedir, agrupados por proveedor, cada proveedor desplegable y con «Armar compra»), «Alertas de stock» e «Historial de actividad» (solo administración, con el total y «Mostrar 25 más»).
- **Diferencia con el prototipo:** el prototipo deja agregar a mano mercadería fuera del catálogo al pedido pendiente. Acá se marca desde la ficha del producto (D-031); agregar ítems sueltos requeriría una tabla nueva y queda para cuando el dueño lo pida.

## D-038 · Ventas y Clientes como el prototipo, y menos demora entre click y pantalla
- **Estado:** Aceptada. Sin migraciones. Correcciones del dueño al probar el Preview.
- **Nueva venta:** buscar el cliente (por defecto Consumidor final), elegir el comprobante y «Continuar», como el prototipo. Si el cliente no existe aparece «+ Crear cliente «…»» y se da de alta en una ventana emergente sin salir de la pantalla (también desde el buscador de cliente dentro de la venta). «Dejar en cuenta corriente» ya no está en el buscador: va dentro de la venta, siempre visible y deshabilitada con la explicación cuando el cliente no la tiene. La **nota de crédito sin venta de origen** es un tipo de comprobante más («Nota de crédito») y también se inicia desde la ficha del cliente («+ Venta» y «+ Nota de crédito», como el perfil del prototipo).
- **Clientes:** de entrada el buscador (nombre, CUIT, teléfono o mail) y no la lista entera; si no encuentra, ofrece crear el cliente. Sin búsqueda se ven los «Últimos 10 con operaciones». «Ver listado completo» lo despliega (se pide recién en ese momento) y se ordena con un click en cada columna. «Descargar lista» (CSV) pide el permiso de descargar.
- **Secciones desplegables y columnas ordenables:** componentes comunes (`Orden.tsx`): `Desplegable`/`Seccion` (▸/▾) y `useOrden` + `Th` (click en el encabezado; un segundo click invierte; los vacíos quedan al final). En Ventas: «Ventas abiertas» abierta de entrada y «Últimas 10 ventas» cerrada, con columnas ordenables.
- **Demoras (causa):** el Preview corría la aplicación en Washington (`iad1`) mientras la base está en San Pablo; cada consulta cruzaba el continente ida y vuelta, y una pantalla hace varias. Se fija la región de las funciones en San Pablo (`apps/panel/vercel.json`, `gru1`), como decía D-009.
- **Demoras (aplicación):** cada consulta abría la transacción con tres viajes a la base (BEGIN, rol y comercio); ahora va en uno. La sesión se consulta una vez por pedido (antes el menú y la página la pedían por separado). El pool pasa de 3 a 6 conexiones (las pantallas piden varias cosas en paralelo) y conserva las conexiones ociosas 60 s. Al cambiar de pantalla se muestra «Cargando…» al instante.

## D-039 · Compras y Proveedores como el prototipo (igual que Ventas y Clientes)
- **Estado:** Aceptada. Sin migraciones. Pedido del dueño después de D-038.
- **Nueva compra:** buscar el proveedor, elegir el comprobante (Remito, Factura A, Factura B, Sin comprobante o **Nota de crédito**) y «Continuar». Si el proveedor no existe aparece «+ Crear proveedor «…»» y se da de alta en una ventana emergente (también desde el buscador de proveedor dentro de la compra). La nota de crédito de proveedor necesita el proveedor elegido (es contra su cuenta corriente, D-036). «Compras abiertas» abierta de entrada y «Últimas 10 compras» desplegable, con columnas ordenables; el buscador de compras se mantiene.
- **Proveedores:** igual que Clientes: el buscador de entrada (nombre, contacto, CUIT, teléfono o mail) con alta si no encuentra, «Últimos 10 con operaciones» (su última compra), «Ver listado completo» desplegable y ordenable, «Descargar lista» (permiso de descargar) e «Informes de proveedores». En la ficha, «+ Compra» y «+ Nota de crédito».

## D-040 · Cajas y Productos como el prototipo
- **Estado:** Aceptada. Sin migraciones. Pedido del dueño después de D-039.
- **Cajas:** «+ Nueva caja» (lleva a configurar cajas), la lista con estado («Abierta» / «🔒 Cerrada») y saldo, y dos secciones desplegables como el prototipo: «Movimientos de caja de los usuarios» (abierta, de a 15 con «Mostrar 15 más» y «Mostrar todos»; el administrador ve los de todos y filtra por usuario, los demás ven solo los suyos y solo de las cajas que pueden ver; la regla se aplica en el servidor) y «Historial de cierres» (cerrada, los últimos 50, con enlace a la tabla completa). Cada movimiento lleva a su venta, compra, recibo u orden de pago, o a la caja.
- **Productos:** de entrada el buscador por nombre o código y el tipo, con resultados mientras se escribe (código · proveedor · stock, precio de la primera lista y costo), y los botones del prototipo: «+ Nuevo», «Modificar masivamente», «Descargar listas», «Exportar» e «Importar» (estos dos con permiso de descargar). El listado con todos los filtros (rubro, tipo, proveedor, dato extra, estado y alertas de stock) pasa a una sección desplegable que se arma recién cuando se pide, con columnas ordenables con un click. «Informes de productos» lleva a Estadísticas.
- **Diferencia con el prototipo:** el prototipo no muestra utilidad en un listado aparte; acá se mantiene el listado con filtros porque ya existía y es útil para revisar stock y precios.
