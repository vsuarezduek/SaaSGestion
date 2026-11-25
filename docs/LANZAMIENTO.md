# Lanzamiento de un comercio que viene del prototipo

Pasos para pasar un comercio del prototipo al sistema (el primero es Mística). Decisión: D-042.
Regla: staging solo con datos **anonimizados**; producción solo con el OK explícito del dueño.

## 1. Volcar el prototipo
- El HTML publicado del prototipo (trae los datos base) y su base de datos, una carpeta por colección (`pm`, `cm`, `vm`, `cc`, `cajas`, `movs`, `ccat`, `cfg`) con un `<id>.json` por documento. Claude lo hace con la herramienta de datos del artifact.
- Todo eso queda **fuera del repositorio** (tiene datos de clientes).

## 2. Exportar a CSV
```bash
node scripts/prototipo/exportar.mjs --html prototipo.html --base volcado/ --salida datos-reales/
node scripts/prototipo/exportar.mjs --html prototipo.html --base volcado/ --salida datos-ensayo/ --anonimizar
```
Si el dueño decide arrancar una caja con otro saldo, se agrega `--saldo-caja "Nombre=importe"` (se puede repetir). En Mística: `--saldo-caja "Mercadopago=0"`.

Cada carpeta queda con `1-proveedores.csv`, `2-clientes.csv`, `3-productos.csv`, `config.json` y `resumen.md` (orden de carga, totales de control, categorías, cajas y avisos). **Leer los avisos** antes de seguir.

## 3. Ensayo en staging (datos anonimizados)
```bash
cd apps/panel
DATABASE_URL_STAGING=… CLAVE_ADMIN=… node --no-warnings scripts/cargar-prototipo.ts \
  --carpeta ../../datos-ensayo --comercio ensayo-mistica --crear --nombre "Ensayo Mística" --email <admin> --admin "<nombre>"
```
Termina con la tabla de control: todo tiene que dar ✓. Después se recorre el Preview (ventas, cajas, cuentas corrientes) con ese comercio.

## 4. Producción (con el OK del dueño)
1. Aplicar las migraciones en la base de producción (vacía): `DATABASE_URL=… scripts/db-migrar.sh`.
2. Volver a volcar y exportar el prototipo **el mismo día del corte** (los saldos cambian todos los días).
3. Cargar con datos reales:
```bash
cd apps/panel
VERCEL_ENV=production DATABASE_URL=… CLAVE_ADMIN=… node --no-warnings scripts/cargar-prototipo.ts \
  --carpeta ../../datos-reales --comercio mistica --crear --produccion --nombre "Mística Natural" --email <admin> --admin "<nombre>"
```
4. A mano en Ajustes: usuarios y permisos, medios de pago y comisiones, recetas, empresa y logo, casilla de correo.
5. Uso en paralelo 2 a 4 semanas comparando cajas y saldos todos los días.
