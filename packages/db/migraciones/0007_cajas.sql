-- 0007 · Cajas: configuración, turnos (apertura/cierre con arqueo) y libro de movimientos de solo agregar.
-- El saldo de una caja NO se guarda: es la suma de sus movimientos. Corregir = movimiento inverso (reversión).
-- Caja cerrada = bloqueada: la base rechaza cualquier movimiento nuevo salvo reversiones (anulaciones).
-- Pendiente en migraciones posteriores: medios de pago y comisiones (con Ventas), impuesto por transacción sobre pagos,
-- reapertura del mismo día por un administrador con motivo.

CREATE TABLE cajas (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nombre    text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 60),
  tipo      text NOT NULL DEFAULT 'efectivo' CHECK (tipo IN ('efectivo','digital')),  -- efectivo: arqueo por conteo; digital: conciliar con app/banco
  impuesto_transaccion numeric(5,2) NOT NULL DEFAULT 0 CHECK (impuesto_transaccion >= 0 AND impuesto_transaccion <= 100),  -- % sobre pagos que salen de esta caja
  orden     int NOT NULL DEFAULT 0,
  activa    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX cajas_nombre_unico ON cajas (tenant_id, lower(nombre));

CREATE TABLE caja_turnos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  caja_id          uuid NOT NULL,
  abierto_en       timestamptz NOT NULL DEFAULT now(),
  abierto_por      uuid,
  apertura_esperada numeric(14,2) NOT NULL,
  apertura_contada  numeric(14,2) NOT NULL,
  cerrado_en       timestamptz,
  cerrado_por      uuid,
  cierre_esperado  numeric(14,2),
  cierre_contado   numeric(14,2),
  cambio_dejado    numeric(14,2),
  traspaso_caja_id uuid,
  traspaso_importe numeric(14,2),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id),
  FOREIGN KEY (tenant_id, traspaso_caja_id) REFERENCES cajas (tenant_id, id),
  CHECK (cerrado_en IS NULL OR (cierre_esperado IS NOT NULL AND cierre_contado IS NOT NULL)),
  CHECK (cambio_dejado IS NULL OR cambio_dejado >= 0)
);
-- Una sola apertura vigente por caja.
CREATE UNIQUE INDEX caja_turno_abierto_unico ON caja_turnos (tenant_id, caja_id) WHERE cerrado_en IS NULL;
CREATE INDEX ON caja_turnos (tenant_id, caja_id, abierto_en DESC);

-- Un turno cerrado no se toca; uno abierto solo puede cerrarse (los datos de apertura no cambian) y nunca se borra.
CREATE FUNCTION app.proteger_turno() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los turnos de caja no se borran' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Un turno cerrado no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.caja_id <> OLD.caja_id OR NEW.abierto_en <> OLD.abierto_en OR NEW.apertura_esperada <> OLD.apertura_esperada OR NEW.apertura_contada <> OLD.apertura_contada THEN
    RAISE EXCEPTION 'Los datos de apertura no se modifican' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER caja_turnos_proteger BEFORE UPDATE OR DELETE ON caja_turnos FOR EACH ROW EXECUTE FUNCTION app.proteger_turno();

CREATE TABLE caja_movimientos (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  caja_id     uuid NOT NULL,
  turno_id    uuid,
  tipo        text NOT NULL CHECK (tipo IN ('ingreso','egreso','transferencia_salida','transferencia_entrada',
                                            'apertura_diferencia','cierre_diferencia','traspaso_salida','traspaso_entrada','reversion')),
  importe     numeric(14,2) NOT NULL CHECK (importe <> 0),    -- + entra a la caja, − sale
  concepto    text CHECK (concepto IS NULL OR length(concepto) <= 200),
  grupo_id    uuid,                                           -- une las dos puntas de una transferencia o traspaso
  revierte_id bigint,
  usuario_id  uuid,
  fecha       timestamptz NOT NULL DEFAULT now(),             -- la que elige la persona (puede ser anterior)
  creado_en   timestamptz NOT NULL DEFAULT now(),             -- cuándo se registró de verdad
  UNIQUE (tenant_id, id),
  CHECK ((tipo = 'reversion') = (revierte_id IS NOT NULL)),
  CHECK (turno_id IS NOT NULL OR tipo = 'reversion'),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id),
  FOREIGN KEY (tenant_id, turno_id) REFERENCES caja_turnos (tenant_id, id),
  FOREIGN KEY (tenant_id, revierte_id) REFERENCES caja_movimientos (tenant_id, id)
);
CREATE UNIQUE INDEX caja_una_reversion ON caja_movimientos (tenant_id, revierte_id) WHERE revierte_id IS NOT NULL;
CREATE INDEX ON caja_movimientos (tenant_id, caja_id, id DESC);
CREATE INDEX ON caja_movimientos (tenant_id, grupo_id) WHERE grupo_id IS NOT NULL;

-- Regla 8: una caja cerrada rechaza cualquier movimiento nuevo, salvo anulaciones (reversiones).
-- Además, el movimiento debe pertenecer al turno abierto de esa misma caja.
CREATE FUNCTION app.validar_movimiento_caja() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF NEW.tipo = 'reversion' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM caja_turnos t WHERE t.id = NEW.turno_id AND t.caja_id = NEW.caja_id AND t.cerrado_en IS NULL) THEN
    RAISE EXCEPTION 'La caja está cerrada: no admite movimientos nuevos' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER caja_movimientos_validar BEFORE INSERT ON caja_movimientos FOR EACH ROW EXECUTE FUNCTION app.validar_movimiento_caja();
CREATE TRIGGER caja_movimientos_solo_agregar BEFORE UPDATE OR DELETE ON caja_movimientos FOR EACH ROW EXECUTE FUNCTION app.solo_agregar();
CREATE TRIGGER caja_movimientos_no_truncar BEFORE TRUNCATE ON caja_movimientos FOR EACH STATEMENT EXECUTE FUNCTION app.solo_agregar();

-- ───────── Seguridad por comercio ─────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cajas','caja_turnos','caja_movimientos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON cajas, caja_turnos TO app_user;
GRANT SELECT, INSERT ON caja_movimientos TO app_user;
GRANT USAGE ON SEQUENCE caja_movimientos_id_seq TO app_user;
