-- 0008 · Ventas: medios de pago (con comisión y cajas habilitadas), ventas y renglones.
-- Una venta cerrada no se edita: solo puede pasar a 'anulada' (la anulación revierte sus movimientos con el inverso).
-- Cada libro (caja, cuenta corriente, stock) guarda a qué venta pertenece cada movimiento.

CREATE TABLE medios_pago (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  nombre        text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 60),
  comision_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (comision_pct >= 0 AND comision_pct <= 100),
  iva_comision  numeric(4,1) NOT NULL DEFAULT 21 CHECK (iva_comision IN (0, 10.5, 21, 27)),  -- IVA que se suma a la comisión
  activo        boolean NOT NULL DEFAULT true,
  orden         int NOT NULL DEFAULT 0,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX medios_pago_nombre_unico ON medios_pago (tenant_id, lower(nombre));

-- Cada medio habilita solo ciertas cajas (efectivo → cajas de efectivo, transferencia → banco, etc.).
CREATE TABLE medio_pago_cajas (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  medio_id  uuid NOT NULL,
  caja_id   uuid NOT NULL,
  PRIMARY KEY (medio_id, caja_id),
  FOREIGN KEY (tenant_id, medio_id) REFERENCES medios_pago (tenant_id, id),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id)
);

CREATE TABLE ventas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  numero           int  NOT NULL CHECK (numero > 0),                 -- correlativo por comercio
  estado           text NOT NULL DEFAULT 'cerrada' CHECK (estado IN ('abierta','cerrada','anulada')),
  clave            uuid,                                             -- evita cerrar dos veces la misma venta (doble clic)
  cliente_id       uuid NOT NULL,
  comprobante      text NOT NULL CHECK (comprobante IN ('remito','factura_a','factura_b','sin_comprobante','nota_credito')),
  nro_comprobante  text CHECK (nro_comprobante IS NULL OR length(nro_comprobante) <= 30),
  lista_id         uuid,
  fecha            timestamptz NOT NULL DEFAULT now(),
  descuento_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  subtotal         numeric(14,2) NOT NULL,                           -- después de descuentos por renglón
  descuento_total  numeric(14,2) NOT NULL DEFAULT 0 CHECK (descuento_total >= 0),
  total            numeric(14,2) NOT NULL CHECK (total >= 0),
  iva_incluido     numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_incluido >= 0),
  en_cuenta_corriente boolean NOT NULL DEFAULT false,
  medio_pago_id    uuid,
  caja_id          uuid,
  comision         numeric(14,2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
  nota             text CHECK (nota IS NULL OR length(nota) <= 500),
  usuario_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      uuid,
  motivo_anulacion text CHECK (motivo_anulacion IS NULL OR length(motivo_anulacion) <= 200),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id),
  FOREIGN KEY (tenant_id, lista_id) REFERENCES listas_precios (tenant_id, id),
  FOREIGN KEY (tenant_id, medio_pago_id) REFERENCES medios_pago (tenant_id, id),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id),
  -- Se cobra en una caja o se deja en cuenta corriente, no las dos cosas.
  CHECK (estado = 'abierta' OR (en_cuenta_corriente AND medio_pago_id IS NULL AND caja_id IS NULL)
                            OR (NOT en_cuenta_corriente AND medio_pago_id IS NOT NULL AND caja_id IS NOT NULL))
);
CREATE UNIQUE INDEX ventas_clave_unica ON ventas (tenant_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX ON ventas (tenant_id, creado_en DESC);
CREATE INDEX ON ventas (tenant_id, cliente_id, creado_en DESC);

CREATE TABLE venta_renglones (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  venta_id      uuid NOT NULL,
  orden         int NOT NULL,
  producto_id   uuid,                                                -- NULL = ítem libre
  descripcion   text NOT NULL CHECK (length(btrim(descripcion)) > 0 AND length(descripcion) <= 200),
  cantidad      numeric(14,3) NOT NULL CHECK (cantidad > 0),
  precio        numeric(14,2) NOT NULL CHECK (precio >= 0),          -- unitario, IVA incluido
  descuento_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  iva           numeric(4,1) NOT NULL CHECK (iva IN (0, 10.5, 21, 27)),
  subtotal      numeric(14,2) NOT NULL,                              -- cantidad × precio − descuento del renglón
  total         numeric(14,2) NOT NULL,                              -- subtotal − parte del descuento total
  iva_incluido  numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas (tenant_id, id),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id)
);
CREATE INDEX ON venta_renglones (tenant_id, venta_id, orden);
CREATE INDEX ON venta_renglones (tenant_id, producto_id) WHERE producto_id IS NOT NULL;

-- Una venta cerrada solo puede pasar a anulada (con quién y cuándo); nada más se modifica. Nunca se borra.
CREATE FUNCTION app.proteger_venta() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las ventas no se borran: se anulan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'Una venta anulada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'cerrada' THEN
    IF NEW.estado <> 'anulada' OR NEW.anulada_en IS NULL
       OR (NEW.total, NEW.subtotal, NEW.cliente_id, NEW.numero, NEW.comision, NEW.caja_id, NEW.en_cuenta_corriente)
          IS DISTINCT FROM (OLD.total, OLD.subtotal, OLD.cliente_id, OLD.numero, OLD.comision, OLD.caja_id, OLD.en_cuenta_corriente) THEN
      RAISE EXCEPTION 'Una venta cerrada solo se puede anular' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ventas_proteger BEFORE UPDATE OR DELETE ON ventas FOR EACH ROW EXECUTE FUNCTION app.proteger_venta();
CREATE TRIGGER renglones_solo_agregar BEFORE UPDATE OR DELETE ON venta_renglones FOR EACH ROW EXECUTE FUNCTION app.solo_agregar();

-- ───────── Los tres libros reconocen las ventas ─────────
ALTER TABLE cuenta_corriente_movimientos DROP CONSTRAINT cuenta_corriente_movimientos_tipo_check;
ALTER TABLE cuenta_corriente_movimientos ADD CONSTRAINT cuenta_corriente_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta'));
ALTER TABLE cuenta_corriente_movimientos ADD COLUMN venta_id uuid, ADD FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas (tenant_id, id);

ALTER TABLE stock_movimientos DROP CONSTRAINT stock_movimientos_tipo_check;
ALTER TABLE stock_movimientos ADD CONSTRAINT stock_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta'));
ALTER TABLE stock_movimientos ADD COLUMN venta_id uuid, ADD FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas (tenant_id, id);

ALTER TABLE caja_movimientos DROP CONSTRAINT caja_movimientos_tipo_check;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_check CHECK (tipo IN ('ingreso','egreso','transferencia_salida','transferencia_entrada',
  'apertura_diferencia','cierre_diferencia','traspaso_salida','traspaso_entrada','reversion','cobro_venta','comision_venta'));
ALTER TABLE caja_movimientos ADD COLUMN venta_id uuid, ADD FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas (tenant_id, id);

-- ───────── Seguridad por comercio ─────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['medios_pago','medio_pago_cajas','ventas','venta_renglones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON medios_pago, ventas TO app_user;
GRANT SELECT, INSERT, DELETE ON medio_pago_cajas TO app_user;
GRANT SELECT, INSERT ON venta_renglones TO app_user;
GRANT USAGE ON SEQUENCE venta_renglones_id_seq TO app_user;
