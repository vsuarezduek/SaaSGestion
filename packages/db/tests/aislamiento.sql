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

ROLLBACK;  -- los tests no dejan datos
