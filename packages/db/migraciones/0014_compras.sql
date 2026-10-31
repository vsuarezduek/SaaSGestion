-- 0014 · Compras y órdenes de pago a proveedores (espejo de ventas y recibos).
-- Una compra cerrada no se edita: solo puede pasar a 'anulada' (la anulación revierte caja, stock y cuenta corriente con el inverso).
-- Editar = anular la original y cargar la nueva en la misma transacción (compra_origen).
-- El costo de la compra viene SIN IVA; si el comprobante es factura, el IVA se suma encima.

CREATE TABLE categorias_compra (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nombre    text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 60),
  orden     int  NOT NULL DEFAULT 0,
  activa    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX categorias_compra_nombre_unico ON categorias_compra (tenant_id, lower(nombre));

CREATE TABLE compras (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  numero           int  NOT NULL CHECK (numero > 0),                 -- correlativo por comercio
  estado           text NOT NULL DEFAULT 'cerrada' CHECK (estado IN ('cerrada','anulada')),
  clave            uuid,                                             -- evita cerrar dos veces la misma compra (doble clic)
  proveedor_id     uuid NOT NULL,
  categoria        text NOT NULL DEFAULT 'Mercadería' CHECK (length(btrim(categoria)) > 0 AND length(categoria) <= 60),
  comprobante      text NOT NULL CHECK (comprobante IN ('remito','factura_a','factura_b','sin_comprobante')),
  nro_comprobante  text CHECK (nro_comprobante IS NULL OR length(nro_comprobante) <= 30),
  fecha            timestamptz NOT NULL DEFAULT now(),
  descuento_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  subtotal         numeric(14,2) NOT NULL,                           -- neto después de descuentos por renglón
  descuento_total  numeric(14,2) NOT NULL DEFAULT 0 CHECK (descuento_total >= 0),
  neto             numeric(14,2) NOT NULL CHECK (neto >= 0),
  iva              numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
  total            numeric(14,2) NOT NULL CHECK (total >= 0),
  en_cuenta_corriente boolean NOT NULL DEFAULT false,
  caja_id          uuid,
  impuesto         numeric(14,2) NOT NULL DEFAULT 0 CHECK (impuesto >= 0),   -- impuesto por transacción de la caja
  modo_costos      text NOT NULL DEFAULT 'costo_y_precio' CHECK (modo_costos IN ('ninguno','costo','costo_y_precio')),
  nota             text CHECK (nota IS NULL OR length(nota) <= 500),
  compra_origen_id uuid,                                             -- la compra que esta reemplaza (edición)
  usuario_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      uuid,
  motivo_anulacion text CHECK (motivo_anulacion IS NULL OR length(motivo_anulacion) <= 200),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero),
  FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedores (tenant_id, id),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id),
  FOREIGN KEY (tenant_id, compra_origen_id) REFERENCES compras (tenant_id, id),
  -- Se paga desde una caja o se deja en cuenta corriente, no las dos cosas.
  CHECK ((en_cuenta_corriente AND caja_id IS NULL) OR (NOT en_cuenta_corriente AND caja_id IS NOT NULL))
);
CREATE UNIQUE INDEX compras_clave_unica ON compras (tenant_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX ON compras (tenant_id, creado_en DESC);
CREATE INDEX ON compras (tenant_id, proveedor_id, creado_en DESC);

CREATE TABLE compra_renglones (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  compra_id     uuid NOT NULL,
  orden         int NOT NULL,
  producto_id   uuid,                                                -- NULL = ítem libre
  descripcion   text NOT NULL CHECK (length(btrim(descripcion)) > 0 AND length(descripcion) <= 200),
  cantidad      numeric(14,3) NOT NULL CHECK (cantidad > 0),
  costo         numeric(14,2) NOT NULL CHECK (costo >= 0),           -- unitario, sin IVA
  descuento_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  iva           numeric(4,1) NOT NULL CHECK (iva IN (0, 10.5, 21, 27)),
  subtotal      numeric(14,2) NOT NULL,                              -- cantidad × costo − descuento del renglón
  neto          numeric(14,2) NOT NULL,                              -- subtotal − parte del descuento total
  iva_monto     numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, compra_id) REFERENCES compras (tenant_id, id),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id)
);
CREATE INDEX ON compra_renglones (tenant_id, compra_id, orden);
CREATE INDEX ON compra_renglones (tenant_id, producto_id) WHERE producto_id IS NOT NULL;

CREATE FUNCTION app.proteger_compra() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las compras no se borran: se anulan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'Una compra anulada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado <> 'anulada' OR NEW.anulada_en IS NULL
     OR (NEW.total, NEW.proveedor_id, NEW.numero, NEW.caja_id, NEW.comprobante, NEW.impuesto)
        IS DISTINCT FROM (OLD.total, OLD.proveedor_id, OLD.numero, OLD.caja_id, OLD.comprobante, OLD.impuesto) THEN
    RAISE EXCEPTION 'Una compra cerrada solo se puede anular' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compras_proteger BEFORE UPDATE OR DELETE ON compras FOR EACH ROW EXECUTE FUNCTION app.proteger_compra();

CREATE FUNCTION app.proteger_renglon_compra() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'Los renglones de una compra no se modifican ni se borran' USING ERRCODE = 'restrict_violation'; END $$;
CREATE TRIGGER compra_renglones_proteger BEFORE UPDATE OR DELETE ON compra_renglones FOR EACH ROW EXECUTE FUNCTION app.proteger_renglon_compra();

-- ───────── Órdenes de pago: se le paga (total o parcialmente) al proveedor lo que se le debe ─────────
CREATE TABLE ordenes_pago (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  numero           int  NOT NULL CHECK (numero > 0),
  estado           text NOT NULL DEFAULT 'cerrada' CHECK (estado IN ('cerrada','anulada')),
  clave            uuid,
  proveedor_id     uuid NOT NULL,
  compra_id        uuid,                                             -- compra que se está pagando (informativo; el saldo es del proveedor)
  fecha            timestamptz NOT NULL DEFAULT now(),
  importe          numeric(14,2) NOT NULL CHECK (importe > 0),
  caja_id          uuid NOT NULL,
  impuesto         numeric(14,2) NOT NULL DEFAULT 0 CHECK (impuesto >= 0),
  nota             text CHECK (nota IS NULL OR length(nota) <= 500),
  usuario_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      uuid,
  motivo_anulacion text CHECK (motivo_anulacion IS NULL OR length(motivo_anulacion) <= 200),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero),
  FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedores (tenant_id, id),
  FOREIGN KEY (tenant_id, compra_id) REFERENCES compras (tenant_id, id),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id)
);
CREATE UNIQUE INDEX ordenes_pago_clave_unica ON ordenes_pago (tenant_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX ON ordenes_pago (tenant_id, proveedor_id, creado_en DESC);

CREATE FUNCTION app.proteger_orden_pago() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las órdenes de pago no se borran: se anulan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'Una orden de pago anulada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado <> 'anulada' OR NEW.anulada_en IS NULL
     OR (NEW.importe, NEW.proveedor_id, NEW.numero, NEW.impuesto, NEW.caja_id)
        IS DISTINCT FROM (OLD.importe, OLD.proveedor_id, OLD.numero, OLD.impuesto, OLD.caja_id) THEN
    RAISE EXCEPTION 'Una orden de pago cerrada solo se puede anular' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ordenes_pago_proteger BEFORE UPDATE OR DELETE ON ordenes_pago FOR EACH ROW EXECUTE FUNCTION app.proteger_orden_pago();

-- ───────── Los libros reconocen compras y órdenes de pago ─────────
ALTER TABLE stock_movimientos DROP CONSTRAINT stock_movimientos_tipo_check;
ALTER TABLE stock_movimientos ADD CONSTRAINT stock_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','devolucion_venta','compra'));
ALTER TABLE stock_movimientos ADD COLUMN compra_id uuid, ADD FOREIGN KEY (tenant_id, compra_id) REFERENCES compras (tenant_id, id);

ALTER TABLE cuenta_corriente_movimientos DROP CONSTRAINT cuenta_corriente_movimientos_tipo_check;
ALTER TABLE cuenta_corriente_movimientos ADD CONSTRAINT cuenta_corriente_movimientos_tipo_check
  CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','recibo','nota_credito','devolucion_pago','compra','orden_pago'));
ALTER TABLE cuenta_corriente_movimientos
  ADD COLUMN compra_id uuid, ADD COLUMN orden_pago_id uuid,
  ADD FOREIGN KEY (tenant_id, compra_id) REFERENCES compras (tenant_id, id),
  ADD FOREIGN KEY (tenant_id, orden_pago_id) REFERENCES ordenes_pago (tenant_id, id);

ALTER TABLE caja_movimientos DROP CONSTRAINT caja_movimientos_tipo_check;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_check CHECK (tipo IN ('ingreso','egreso','transferencia_salida','transferencia_entrada',
  'apertura_diferencia','cierre_diferencia','traspaso_salida','traspaso_entrada','reversion','cobro_venta','comision_venta','cobro_recibo','comision_recibo',
  'devolucion_venta','devolucion_pago','pago_compra','impuesto_compra','pago_orden','impuesto_orden'));
ALTER TABLE caja_movimientos
  ADD COLUMN compra_id uuid, ADD COLUMN orden_pago_id uuid,
  ADD FOREIGN KEY (tenant_id, compra_id) REFERENCES compras (tenant_id, id),
  ADD FOREIGN KEY (tenant_id, orden_pago_id) REFERENCES ordenes_pago (tenant_id, id);

-- ───────── Seguridad por comercio ─────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['categorias_compra','compras','compra_renglones','ordenes_pago'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON categorias_compra, compras, ordenes_pago TO app_user;
GRANT SELECT, INSERT ON compra_renglones TO app_user;
GRANT USAGE ON SEQUENCE compra_renglones_id_seq TO app_user;
