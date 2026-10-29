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
