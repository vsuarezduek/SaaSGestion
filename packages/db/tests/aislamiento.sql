-- Aislamiento entre comercios (multi-tenant) y libros de solo agregado.
-- Cada bloque falla con EXCEPTION si el comportamiento esperado no se cumple.
\set ON_ERROR_STOP on
BEGIN;

-- Alta de dos comercios (como lo haría el registro).
SELECT app.crear_comercio('mistica-test', 'Mística Test', 'dietetica', 'ana@mistica.test', 'Ana', 'hash-a') AS a \gset
SELECT app.crear_comercio('ropa-test',   'Ropa Test',     'ropa',      'ana@mistica.test', 'Ana', 'hash-b') AS b \gset
-- (mismo email en comercios distintos: permitido)

SET LOCAL ROLE app_user;

-- 1) Sin comercio fijado no se ve nada.
DO $$ BEGIN
  IF (SELECT count(*) FROM tenants) <> 0 THEN RAISE EXCEPTION 'sin tenant: se ven comercios'; END IF;
  IF (SELECT count(*) FROM usuarios) <> 0 THEN RAISE EXCEPTION 'sin tenant: se ven usuarios'; END IF;
END $$;

-- 2) Con el comercio A, solo se ve lo de A.
SELECT set_config('app.tenant_id', :'a', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM tenants) <> 1 THEN RAISE EXCEPTION 'A: debería ver 1 comercio'; END IF;
  IF (SELECT slug FROM tenants) <> 'mistica-test' THEN RAISE EXCEPTION 'A: comercio equivocado'; END IF;
  IF (SELECT count(*) FROM usuarios) <> 1 THEN RAISE EXCEPTION 'A: debería ver 1 usuario'; END IF;
  IF (SELECT count(*) FROM auditoria) <> 1 THEN RAISE EXCEPTION 'A: debería ver 1 registro de auditoría'; END IF;
END $$;

-- 3) Con A no se puede escribir en B ni inventar un comercio.
SELECT set_config('test.b', :'b', false);
DO $$ BEGIN
  BEGIN
    INSERT INTO usuarios (tenant_id, email, nombre, rol) VALUES (current_setting('test.b')::uuid, 'x@x.test', 'Intruso', 'atencion');
    RAISE EXCEPTION 'A pudo insertar con el tenant_id de B';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO usuarios (tenant_id, email, nombre, rol) VALUES (gen_random_uuid(), 'y@y.test', 'Intruso', 'atencion');
    RAISE EXCEPTION 'A pudo insertar con un tenant_id inventado';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 4) Con A, un UPDATE sobre usuarios de B no afecta ninguna fila.
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM usuarios) <> 1 THEN RAISE EXCEPTION 'B: debería ver 1 usuario'; END IF;
END $$;
SELECT set_config('app.tenant_id', :'a', true);
DO $$ DECLARE n int; BEGIN
  UPDATE usuarios SET nombre = 'hackeado' WHERE nombre = 'Ana' AND tenant_id <> app.tenant_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'A modificó usuarios ajenos (% filas)', n; END IF;
END $$;

-- 5) Un administrador exige contraseña.
DO $$ BEGIN
  BEGIN
    INSERT INTO usuarios (tenant_id, email, nombre, rol) VALUES (app.tenant_id(), 'adm2@x.test', 'Sin clave', 'administrador');
    RAISE EXCEPTION 'se creó un administrador sin contraseña';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 6) Auditoría: se puede agregar, no se puede modificar ni borrar ni truncar.
INSERT INTO auditoria (tenant_id, accion, entidad) VALUES (app.tenant_id(), 'prueba', 'test');
DO $$ BEGIN
  BEGIN UPDATE auditoria SET accion = 'x'; RAISE EXCEPTION 'se pudo modificar la auditoría';
  EXCEPTION WHEN restrict_violation OR insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM auditoria; RAISE EXCEPTION 'se pudo borrar la auditoría';
  EXCEPTION WHEN restrict_violation OR insufficient_privilege THEN NULL; END;
END $$;

-- 6b) Aun el dueño de las tablas (que saltea los permisos) es frenado por el trigger.
RESET ROLE;
SELECT set_config('app.tenant_id', :'a', true);
DO $$ BEGIN
  BEGIN UPDATE auditoria SET accion = 'x'; RAISE EXCEPTION 'el dueño pudo modificar la auditoría';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN DELETE FROM auditoria; RAISE EXCEPTION 'el dueño pudo borrar la auditoría';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
END $$;
SET LOCAL ROLE app_user;

-- 7) Resolver comercio por slug funciona sin contexto y no expone otros datos.
SELECT set_config('app.tenant_id', '', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM app.tenant_por_slug('mistica-test')) <> 1 THEN RAISE EXCEPTION 'tenant_por_slug no encontró el comercio'; END IF;
  IF (SELECT count(*) FROM app.tenant_por_slug('no-existe')) <> 0 THEN RAISE EXCEPTION 'tenant_por_slug devolvió algo inexistente'; END IF;
END $$;

-- 8) Slug inválido o repetido se rechaza.
DO $$ BEGIN
  BEGIN PERFORM app.crear_comercio('Mala Slug!', 'X', 'general', 'a@a.test', 'A', 'h'); RAISE EXCEPTION 'aceptó un slug inválido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM app.crear_comercio('mistica-test', 'Repetido', 'general', 'b@b.test', 'B', 'h'); RAISE EXCEPTION 'aceptó un slug repetido';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- 9) Intentos de ingreso: aislados por comercio.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO intentos_ingreso (tenant_id, email, ip_hash, exito) VALUES (app.tenant_id(), 'x@x.test', 'h', false);
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM intentos_ingreso) <> 0 THEN RAISE EXCEPTION 'B ve intentos de ingreso de A'; END IF;
  BEGIN
    INSERT INTO intentos_ingreso (tenant_id, email, ip_hash, exito) VALUES (gen_random_uuid(), 'y@y.test', 'h', false);
    RAISE EXCEPTION 'B pudo insertar intentos con otro tenant_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 10) Catálogo: aislado por comercio y con integridad entre comercios.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO rubros (tenant_id, nombre) VALUES (app.tenant_id(), 'Almacén');
SELECT set_config('test.rubroa', (SELECT id::text FROM rubros), false);
INSERT INTO productos (tenant_id, codigo, nombre, rubro_id) SELECT app.tenant_id(), 'A1', 'Almendras', id FROM rubros;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM productos) <> 0 THEN RAISE EXCEPTION 'B ve productos de A'; END IF;
  IF (SELECT count(*) FROM rubros) <> 0 THEN RAISE EXCEPTION 'B ve rubros de A'; END IF;
  -- El mismo código en otro comercio está permitido.
  INSERT INTO productos (tenant_id, codigo, nombre) VALUES (app.tenant_id(), 'A1', 'Otra cosa');
  -- Un producto de B no puede colgar de un rubro de A.
  BEGIN
    INSERT INTO productos (tenant_id, codigo, nombre, rubro_id)
      SELECT app.tenant_id(), 'B2', 'Intruso', NULL;
    UPDATE productos SET rubro_id = (SELECT current_setting('test.rubroa')::uuid) WHERE codigo = 'B2';
    RAISE EXCEPTION 'un producto de B quedó dentro de un rubro de A';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
-- Dos productos con el mismo código (sin importar mayúsculas) en un comercio: rechazado.
SELECT set_config('app.tenant_id', :'a', true);
DO $$ BEGIN
  BEGIN
    INSERT INTO productos (tenant_id, codigo, nombre) VALUES (app.tenant_id(), 'a1', 'Duplicado');
    RAISE EXCEPTION 'aceptó un código repetido';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO productos (tenant_id, codigo, nombre, costo) VALUES (app.tenant_id(), 'N1', 'Costo negativo', -1);
    RAISE EXCEPTION 'aceptó un costo negativo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO productos (tenant_id, codigo, nombre, iva) VALUES (app.tenant_id(), 'N2', 'IVA raro', 5);
    RAISE EXCEPTION 'aceptó un IVA inválido';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 11) Clientes, proveedores y libro de cuenta corriente.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO clientes (tenant_id, nombre, es_consumidor_final) VALUES (app.tenant_id(), 'Consumidor Final', true);
INSERT INTO proveedores (tenant_id, nombre) VALUES (app.tenant_id(), 'Proveedor A');
INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe)
  SELECT app.tenant_id(), id, 'saldo_inicial', 1500.50 FROM clientes;
SELECT set_config('test.cliente_a', (SELECT id::text FROM clientes), false);
SELECT set_config('test.mov_a', (SELECT id::text FROM cuenta_corriente_movimientos), false);
DO $$ BEGIN
  -- Solo un Consumidor Final por comercio.
  BEGIN
    INSERT INTO clientes (tenant_id, nombre, es_consumidor_final) VALUES (app.tenant_id(), 'Otro CF', true);
    RAISE EXCEPTION 'aceptó dos consumidores finales';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- El libro es de solo agregar.
  BEGIN
    UPDATE cuenta_corriente_movimientos SET importe = 1;
    RAISE EXCEPTION 'permitió modificar un movimiento';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM cuenta_corriente_movimientos;
    RAISE EXCEPTION 'permitió borrar un movimiento';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  -- Un movimiento no puede ser de cliente y proveedor a la vez, ni de ninguno.
  BEGIN
    INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe)
      SELECT app.tenant_id(), (SELECT id FROM clientes), (SELECT id FROM proveedores), 'ajuste', 5;
    RAISE EXCEPTION 'aceptó cliente y proveedor juntos';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Una reversión referencia al original y solo se puede hacer una vez.
  INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, revierte_id)
    SELECT app.tenant_id(), id, 'reversion', -1500.50, current_setting('test.mov_a')::bigint FROM clientes;
  BEGIN
    INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, revierte_id)
      SELECT app.tenant_id(), id, 'reversion', -1500.50, current_setting('test.mov_a')::bigint FROM clientes;
    RAISE EXCEPTION 'aceptó revertir dos veces';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT sum(importe) FROM cuenta_corriente_movimientos) <> 0 THEN RAISE EXCEPTION 'el saldo no volvió a cero'; END IF;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM clientes) + (SELECT count(*) FROM proveedores) + (SELECT count(*) FROM cuenta_corriente_movimientos) <> 0 THEN
    RAISE EXCEPTION 'B ve clientes, proveedores o movimientos de A'; END IF;
  -- B no puede registrar un movimiento sobre un cliente de A.
  BEGIN
    INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe)
      VALUES (app.tenant_id(), current_setting('test.cliente_a')::uuid, 'ajuste', 10);
    RAISE EXCEPTION 'B movió la cuenta de un cliente de A';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

-- 12) Stock: libro de solo agregar, aislado, con reversión única y que admite negativo.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO productos (tenant_id, codigo, nombre) VALUES (app.tenant_id(), 'S1', 'Con stock');
INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad)
  SELECT app.tenant_id(), id, 'saldo_inicial', 5.500 FROM productos WHERE codigo = 'S1';
SELECT set_config('test.prod_s', (SELECT id::text FROM productos WHERE codigo = 'S1'), false);
SELECT set_config('test.mov_s', (SELECT id::text FROM stock_movimientos), false);
DO $$ BEGIN
  -- Puede quedar negativo.
  INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad)
    VALUES (app.tenant_id(), current_setting('test.prod_s')::uuid, 'ajuste', -8);
  IF (SELECT sum(cantidad) FROM stock_movimientos) <> -2.5 THEN RAISE EXCEPTION 'el stock negativo no se calcula bien'; END IF;
  BEGIN UPDATE stock_movimientos SET cantidad = 1; RAISE EXCEPTION 'permitió modificar stock';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM stock_movimientos; RAISE EXCEPTION 'permitió borrar stock';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad) VALUES (app.tenant_id(), current_setting('test.prod_s')::uuid, 'ajuste', 0);
    RAISE EXCEPTION 'aceptó cantidad cero';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, revierte_id)
    VALUES (app.tenant_id(), current_setting('test.prod_s')::uuid, 'reversion', -5.5, current_setting('test.mov_s')::bigint);
  BEGIN
    INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, revierte_id)
      VALUES (app.tenant_id(), current_setting('test.prod_s')::uuid, 'reversion', -5.5, current_setting('test.mov_s')::bigint);
    RAISE EXCEPTION 'aceptó revertir dos veces';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM stock_movimientos) <> 0 THEN RAISE EXCEPTION 'B ve stock de A'; END IF;
  BEGIN
    INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad) VALUES (app.tenant_id(), current_setting('test.prod_s')::uuid, 'ajuste', 1);
    RAISE EXCEPTION 'B movió stock de un producto de A';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

-- 13) Cajas: aisladas, de solo agregar y bloqueadas cuando están cerradas.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO cajas (tenant_id, nombre) VALUES (app.tenant_id(), 'Efectivo');
SELECT set_config('test.caja_a', (SELECT id::text FROM cajas), false);
DO $$ BEGIN
  -- Caja sin turno abierto: rechaza movimientos.
  BEGIN
    INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe)
      VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, NULL, 'ingreso', 100);
    RAISE EXCEPTION 'aceptó un movimiento sin turno';
  EXCEPTION WHEN restrict_violation OR check_violation THEN NULL; END;
  INSERT INTO caja_turnos (tenant_id, caja_id, apertura_esperada, apertura_contada)
    VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, 0, 500);
  PERFORM set_config('test.turno_a', (SELECT id::text FROM caja_turnos), false);
  -- Dos turnos abiertos en la misma caja: rechazado.
  BEGIN
    INSERT INTO caja_turnos (tenant_id, caja_id, apertura_esperada, apertura_contada)
      VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, 0, 0);
    RAISE EXCEPTION 'aceptó dos turnos abiertos';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe)
    VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, current_setting('test.turno_a')::uuid, 'ingreso', 1000.50);
  PERFORM set_config('test.cmov_a', (SELECT id::text FROM caja_movimientos), false);
  BEGIN UPDATE caja_movimientos SET importe = 1; RAISE EXCEPTION 'permitió modificar caja';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM caja_movimientos; RAISE EXCEPTION 'permitió borrar caja';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  -- Cerrar el turno.
  UPDATE caja_turnos SET cerrado_en = now(), cierre_esperado = 1000.50, cierre_contado = 1000.50 WHERE id = current_setting('test.turno_a')::uuid;
  -- Caja cerrada: rechaza movimientos nuevos, pero admite la anulación.
  BEGIN
    INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe)
      VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, current_setting('test.turno_a')::uuid, 'ingreso', 5);
    RAISE EXCEPTION 'aceptó un movimiento en caja cerrada';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, revierte_id)
    VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, NULL, 'reversion', -1000.50, current_setting('test.cmov_a')::bigint);
  BEGIN
    INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, revierte_id)
      VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, NULL, 'reversion', -1000.50, current_setting('test.cmov_a')::bigint);
    RAISE EXCEPTION 'aceptó anular dos veces';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- Un turno cerrado no se toca ni se borra.
  BEGIN UPDATE caja_turnos SET cierre_contado = 1; RAISE EXCEPTION 'permitió tocar un turno cerrado';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM caja_turnos; RAISE EXCEPTION 'permitió borrar un turno';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  IF (SELECT sum(importe) FROM caja_movimientos) <> 0 THEN RAISE EXCEPTION 'el saldo de la caja no volvió a cero'; END IF;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM cajas) + (SELECT count(*) FROM caja_turnos) + (SELECT count(*) FROM caja_movimientos) <> 0 THEN
    RAISE EXCEPTION 'B ve cajas de A'; END IF;
  BEGIN
    INSERT INTO caja_turnos (tenant_id, caja_id, apertura_esperada, apertura_contada)
      VALUES (app.tenant_id(), current_setting('test.caja_a')::uuid, 0, 0);
    RAISE EXCEPTION 'B abrió una caja de A';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

-- 14) Ventas: aisladas, inmutables una vez cerradas, y vinculadas a los libros.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO clientes (tenant_id, nombre) VALUES (app.tenant_id(), 'Cliente venta');
INSERT INTO ventas (tenant_id, numero, cliente_id, comprobante, subtotal, total, en_cuenta_corriente)
  SELECT app.tenant_id(), 1, id, 'remito', 1000, 1000, true FROM clientes WHERE nombre = 'Cliente venta';
SELECT set_config('test.venta_a', (SELECT id::text FROM ventas), false);
INSERT INTO venta_renglones (tenant_id, venta_id, orden, descripcion, cantidad, precio, iva, subtotal, total)
  VALUES (app.tenant_id(), current_setting('test.venta_a')::uuid, 1, 'Ítem libre', 2.500, 400, 21, 1000, 1000);
INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, venta_id)
  SELECT app.tenant_id(), cliente_id, 'venta', 1000, id FROM ventas;
DO $$ BEGIN
  -- Número correlativo único por comercio.
  BEGIN
    INSERT INTO ventas (tenant_id, numero, cliente_id, comprobante, subtotal, total, en_cuenta_corriente)
      SELECT app.tenant_id(), 1, cliente_id, 'remito', 1, 1, true FROM ventas;
    RAISE EXCEPTION 'aceptó un número repetido';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- Cobra en caja o en cuenta corriente, no ninguna de las dos.
  BEGIN
    INSERT INTO ventas (tenant_id, numero, cliente_id, comprobante, subtotal, total, en_cuenta_corriente)
      SELECT app.tenant_id(), 2, cliente_id, 'remito', 1, 1, false FROM ventas;
    RAISE EXCEPTION 'aceptó una venta sin forma de cobro';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Una venta cerrada no cambia sus importes ni se borra; los renglones tampoco.
  BEGIN UPDATE ventas SET total = 1; RAISE EXCEPTION 'permitió cambiar una venta cerrada';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM ventas; RAISE EXCEPTION 'permitió borrar una venta';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN UPDATE venta_renglones SET cantidad = 9; RAISE EXCEPTION 'permitió cambiar un renglón';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  -- Sí se puede anular.
  UPDATE ventas SET estado = 'anulada', anulada_en = now(), motivo_anulacion = 'prueba';
  BEGIN UPDATE ventas SET nota = 'x'; RAISE EXCEPTION 'permitió tocar una venta anulada';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM ventas) + (SELECT count(*) FROM venta_renglones) + (SELECT count(*) FROM medios_pago) <> 0 THEN
    RAISE EXCEPTION 'B ve ventas de A'; END IF;
END $$;

-- 15) Recibos: aislados, inmutables una vez cerrados, vinculados a los libros de caja y cuenta corriente.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO cajas (tenant_id, nombre) VALUES (app.tenant_id(), 'Caja recibos');
INSERT INTO medios_pago (tenant_id, nombre) VALUES (app.tenant_id(), 'Medio recibos');
INSERT INTO recibos (tenant_id, numero, cliente_id, importe, medio_pago_id, caja_id)
  SELECT app.tenant_id(), 1, (SELECT id FROM clientes WHERE nombre = 'Cliente venta'), 500,
         (SELECT id FROM medios_pago WHERE nombre = 'Medio recibos'), (SELECT id FROM cajas WHERE nombre = 'Caja recibos');
INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, recibo_id)
  SELECT app.tenant_id(), cliente_id, 'recibo', -500, id FROM recibos;
DO $$ BEGIN
  BEGIN
    INSERT INTO recibos (tenant_id, numero, cliente_id, importe, medio_pago_id, caja_id)
      SELECT app.tenant_id(), 1, cliente_id, 1, medio_pago_id, caja_id FROM recibos;
    RAISE EXCEPTION 'aceptó un número repetido';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO recibos (tenant_id, numero, cliente_id, importe, medio_pago_id, caja_id)
      SELECT app.tenant_id(), 2, cliente_id, 0, medio_pago_id, caja_id FROM recibos;
    RAISE EXCEPTION 'aceptó un recibo sin importe';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE recibos SET importe = 1; RAISE EXCEPTION 'permitió cambiar un recibo cerrado';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM recibos; RAISE EXCEPTION 'permitió borrar un recibo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  UPDATE recibos SET estado = 'anulado', anulado_en = now(), motivo_anulacion = 'prueba';
  BEGIN UPDATE recibos SET nota = 'x'; RAISE EXCEPTION 'permitió tocar un recibo anulado';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM recibos) <> 0 THEN RAISE EXCEPTION 'B ve recibos de A'; END IF;
END $$;

-- 16) Ventas abiertas: aisladas, no se borran y una vez cerradas o descartadas no se tocan.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO ventas_abiertas (tenant_id, cliente_id, datos, renglones, total)
  SELECT app.tenant_id(), id, '{}'::jsonb, 1, 100 FROM clientes WHERE nombre = 'Cliente venta';
DO $$ BEGIN
  UPDATE ventas_abiertas SET version = version + 1, total = 200;          -- abierta: se puede editar
  BEGIN DELETE FROM ventas_abiertas; RAISE EXCEPTION 'permitió borrar una venta abierta';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN UPDATE ventas_abiertas SET estado = 'cerrada'; RAISE EXCEPTION 'permitió cerrar sin venta';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE ventas_abiertas SET estado = 'descartada';
  BEGIN UPDATE ventas_abiertas SET total = 1; RAISE EXCEPTION 'permitió tocar una venta abierta descartada';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM ventas_abiertas) <> 0 THEN RAISE EXCEPTION 'B ve ventas abiertas de A'; END IF;
END $$;

-- 17) Pedidos de clientes: son ventas abiertas con fecha de entrega; la fecha solo vale para pedidos.
SELECT set_config('app.tenant_id', :'a', true);
DO $$ BEGIN
  BEGIN
    INSERT INTO ventas_abiertas (tenant_id, cliente_id, datos, renglones, total, entrega)
      SELECT app.tenant_id(), id, '{}'::jsonb, 1, 100, current_date FROM clientes WHERE nombre = 'Cliente venta';
    RAISE EXCEPTION 'permitió fecha de entrega en una venta que no es pedido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO ventas_abiertas (tenant_id, cliente_id, datos, renglones, total, es_pedido, entrega)
    SELECT app.tenant_id(), id, '{}'::jsonb, 1, 100, true, current_date FROM clientes WHERE nombre = 'Cliente venta';
  IF (SELECT count(*) FROM ventas_abiertas WHERE es_pedido AND estado = 'abierta') <> 1 THEN RAISE EXCEPTION 'falta el pedido'; END IF;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM ventas_abiertas WHERE es_pedido) <> 0 THEN RAISE EXCEPTION 'B ve pedidos de A'; END IF;
END $$;

-- 18) Notas de crédito: solo una nota de crédito puede apuntar a una venta de origen; los libros aceptan los movimientos nuevos.
SELECT set_config('app.tenant_id', :'a', true);
DO $$ DECLARE v uuid; n uuid; c uuid; BEGIN
  SELECT id, cliente_id INTO v, c FROM ventas ORDER BY numero LIMIT 1;
  BEGIN
    INSERT INTO ventas (tenant_id, numero, cliente_id, comprobante, subtotal, total, en_cuenta_corriente, venta_origen_id)
      VALUES (app.tenant_id(), 9001, c, 'remito', 100, 100, true, v);
    RAISE EXCEPTION 'permitió un origen en una venta que no es nota de crédito';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO ventas (tenant_id, numero, cliente_id, comprobante, subtotal, total, en_cuenta_corriente, venta_origen_id)
    VALUES (app.tenant_id(), 9002, c, 'nota_credito', 100, 100, true, v) RETURNING id INTO n;
  INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, venta_id) VALUES (app.tenant_id(), c, 'nota_credito', -100, n);
  IF (SELECT count(*) FROM ventas WHERE venta_origen_id = v) <> 1 THEN RAISE EXCEPTION 'falta la nota de crédito'; END IF;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM ventas WHERE venta_origen_id IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'B ve notas de crédito de A'; END IF;
END $$;

-- 19) Devoluciones de pago: aisladas, no se borran y una vez anuladas no se tocan; los libros aceptan sus movimientos.
SELECT set_config('app.tenant_id', :'a', true);
INSERT INTO cajas (tenant_id, nombre, tipo) VALUES (app.tenant_id(), 'Caja devoluciones', 'efectivo');
DO $$ DECLARE c uuid; k uuid; m uuid; d uuid; BEGIN
  SELECT id INTO c FROM clientes WHERE nombre = 'Cliente venta';
  SELECT id INTO k FROM cajas WHERE nombre = 'Caja devoluciones';
  INSERT INTO medios_pago (tenant_id, nombre) VALUES (app.tenant_id(), 'Medio devoluciones') RETURNING id INTO m;
  INSERT INTO devoluciones_pago (tenant_id, numero, cliente_id, importe, medio_pago_id, caja_id)
    VALUES (app.tenant_id(), 1, c, 100, m, k) RETURNING id INTO d;
  INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, devolucion_id) VALUES (app.tenant_id(), c, 'devolucion_pago', 100, d);
  BEGIN
    INSERT INTO devoluciones_pago (tenant_id, numero, cliente_id, importe, medio_pago_id, caja_id) VALUES (app.tenant_id(), 2, c, 0, m, k);
    RAISE EXCEPTION 'permitió una devolución de importe 0';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM devoluciones_pago; RAISE EXCEPTION 'permitió borrar una devolución';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  BEGIN UPDATE devoluciones_pago SET importe = 999; RAISE EXCEPTION 'permitió cambiar el importe de una devolución cerrada';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
  UPDATE devoluciones_pago SET estado = 'anulada', anulada_en = now();
  BEGIN UPDATE devoluciones_pago SET nota = 'x'; RAISE EXCEPTION 'permitió tocar una devolución anulada';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'permitió%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('app.tenant_id', :'b', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM devoluciones_pago) <> 0 THEN RAISE EXCEPTION 'B ve devoluciones de A'; END IF;
END $$;

ROLLBACK;  -- los tests no dejan datos
