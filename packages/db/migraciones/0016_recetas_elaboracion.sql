-- Recetas, elaboración y costos fijos.
-- Agrega el tipo de movimiento 'elaboracion' al libro de stock (como se hizo con 'venta' y 'compra'); no cambia dinero ni cuenta corriente.

-- Receta: cuánto rinde una tanda e instrucciones. Los ingredientes son otros productos.
ALTER TABLE productos
  ADD COLUMN rinde numeric(14,3) NOT NULL DEFAULT 1 CHECK (rinde > 0),
  ADD COLUMN instrucciones text CHECK (instrucciones IS NULL OR length(instrucciones) <= 20000);

CREATE TABLE receta_ingredientes (
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  producto_id    uuid NOT NULL,                      -- el producto elaborado
  ingrediente_id uuid NOT NULL,
  cantidad       numeric(14,3) NOT NULL CHECK (cantidad > 0),   -- para una tanda completa
  orden          int NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, ingrediente_id),
  CHECK (producto_id <> ingrediente_id),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id),
  FOREIGN KEY (tenant_id, ingrediente_id) REFERENCES productos (tenant_id, id)
);
CREATE INDEX ON receta_ingredientes (tenant_id, ingrediente_id);

-- Elaboraciones registradas: cuánto salió y qué se usó (foto de los insumos al momento). No se editan: se anulan.
CREATE TABLE elaboraciones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  numero           int  NOT NULL CHECK (numero > 0),
  estado           text NOT NULL DEFAULT 'cerrada' CHECK (estado IN ('cerrada','anulada')),
  clave            uuid,
  producto_id      uuid NOT NULL,
  cantidad         numeric(14,3) NOT NULL CHECK (cantidad > 0),
  fecha            timestamptz NOT NULL DEFAULT now(),
  nota             text CHECK (nota IS NULL OR length(nota) <= 500),
  usuario_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      uuid,
  motivo_anulacion text CHECK (motivo_anulacion IS NULL OR length(motivo_anulacion) <= 200),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id)
);
CREATE UNIQUE INDEX elaboraciones_clave_unica ON elaboraciones (tenant_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX ON elaboraciones (tenant_id, producto_id, fecha DESC);

CREATE TABLE elaboracion_insumos (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  elaboracion_id uuid NOT NULL,
  ingrediente_id uuid NOT NULL,
  cantidad       numeric(14,3) NOT NULL CHECK (cantidad > 0),
  FOREIGN KEY (tenant_id, elaboracion_id) REFERENCES elaboraciones (tenant_id, id),
  FOREIGN KEY (tenant_id, ingrediente_id) REFERENCES productos (tenant_id, id)
);
CREATE INDEX ON elaboracion_insumos (tenant_id, elaboracion_id);

CREATE FUNCTION app.proteger_elaboracion() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las elaboraciones no se borran: se anulan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'Una elaboración anulada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado <> 'anulada' OR NEW.anulada_en IS NULL
     OR (NEW.producto_id, NEW.cantidad, NEW.numero) IS DISTINCT FROM (OLD.producto_id, OLD.cantidad, OLD.numero) THEN
    RAISE EXCEPTION 'Una elaboración cerrada solo se puede anular' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER elaboraciones_proteger BEFORE UPDATE OR DELETE ON elaboraciones FOR EACH ROW EXECUTE FUNCTION app.proteger_elaboracion();

CREATE FUNCTION app.proteger_insumo_elaboracion() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'Los insumos de una elaboración no se modifican ni se borran' USING ERRCODE = 'restrict_violation'; END $$;
CREATE TRIGGER elaboracion_insumos_proteger BEFORE UPDATE OR DELETE ON elaboracion_insumos FOR EACH ROW EXECUTE FUNCTION app.proteger_insumo_elaboracion();

-- El libro de stock reconoce la elaboración (suma el producto elaborado y resta los ingredientes).
ALTER TABLE stock_movimientos DROP CONSTRAINT stock_movimientos_tipo_check;
ALTER TABLE stock_movimientos ADD CONSTRAINT stock_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','devolucion_venta','compra','elaboracion'));
ALTER TABLE stock_movimientos ADD COLUMN elaboracion_id uuid, ADD FOREIGN KEY (tenant_id, elaboracion_id) REFERENCES elaboraciones (tenant_id, id);

-- Costos fijos: una configuración por comercio y los productos que representan cada costo (alquiler, luz, personal…).
CREATE TABLE costos_fijos_config (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  activo    boolean NOT NULL DEFAULT false,                         -- sumar el costo fijo al costo de los elaborados
  dias      int NOT NULL DEFAULT 30 CHECK (dias BETWEEN 1 AND 365), -- período de producción que se toma como base
  base      text NOT NULL DEFAULT 'unidades' CHECK (base IN ('unidades','costo_ingredientes'))
);
CREATE TABLE costos_fijos_items (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  producto_id uuid NOT NULL,
  cantidad    numeric(14,3) NOT NULL CHECK (cantidad > 0),          -- cantidad mensual × costo del producto
  PRIMARY KEY (tenant_id, producto_id),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['receta_ingredientes','elaboraciones','elaboracion_insumos','costos_fijos_config','costos_fijos_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON receta_ingredientes, costos_fijos_items TO app_user;
GRANT SELECT, INSERT, UPDATE ON elaboraciones, costos_fijos_config TO app_user;
GRANT SELECT, INSERT ON elaboracion_insumos TO app_user;
GRANT USAGE ON SEQUENCE elaboracion_insumos_id_seq TO app_user;
