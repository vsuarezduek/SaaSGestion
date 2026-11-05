-- 0023 · Permite eliminar un producto que nunca tuvo movimientos. Aditiva (solo otorga permisos).
-- La aplicación solo borra si no hay stock, ventas, compras, elaboraciones ni usos como ingrediente; los libros siguen siendo de solo agregar.
-- Las claves foráneas (sin ON DELETE) impiden además borrar un producto con historia aunque la aplicación fallara.
GRANT DELETE ON productos, producto_precios TO app_user;
