-- 0025 · Notas de crédito de proveedor: devolución de mercadería comprada.
-- Siempre contra cuenta corriente: baja el stock de lo devuelto y baja lo que se le debe al proveedor. Nunca mueve caja.
-- Es un comprobante propio (numeración propia, importes en positivo). No se edita: solo se anula, con movimientos inversos que referencian a los originales.
-- Migración aditiva: no toca tablas de compras ni de ventas.

CREATE TABLE notas_credito_compra (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  numero           int  NOT NULL CHECK (numero > 0),                 -- correlativo por comercio
  estado           text NOT NULL DEFAULT 'cerrada' CHECK (estado IN ('cerrada','anulada')),
  clave            uuid,                                             -- evita emitir dos veces la misma nota (doble clic)
  proveedor_id     uuid NOT NULL,
  compra_origen_id uuid,                                             -- informativo: la compra a la que se refiere (puede no haber)
  comprobante      text NOT NULL CHECK (comprobante IN ('nota_credito_a','nota_credito_b','sin_comprobante')),
  nro_comprobante  text CHECK (nro_comprobante IS NULL OR length(nro_comprobante) <= 30),
  fecha            timestamptz NOT NULL DEFAULT now(),
  subtotal         numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  neto             numeric(14,2) NOT NULL CHECK (neto >= 0),
  iva              numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
  total            numeric(14,2) NOT NULL CHECK (total >= 0),
  nota             text CHECK (nota IS NULL OR length(nota) <= 500),
  usuario_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      uuid,
  motivo_anulacion text CHECK (motivo_anulacion IS NULL OR length(motivo_anulacion) <= 200),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero),
  FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedores (tenant_id, id),
  FOREIGN KEY (tenant_id, compra_origen_id) REFERENCES compras (tenant_id, id)
);
CREATE UNIQUE INDEX notas_credito_compra_clave_unica ON notas_credito_compra (tenant_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX ON notas_credito_compra (tenant_id, proveedor_id, creado_en DESC);
CREATE INDEX ON notas_credito_compra (tenant_id, compra_origen_id) WHERE compra_origen_id IS NOT NULL;

CREATE TABLE nota_credito_compra_renglones (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  nota_id       uuid NOT NULL,
  orden         int NOT NULL,
  producto_id   uuid,                                                -- NULL = ítem libre (no mueve stock)
  descripcion   text NOT NULL CHECK (length(btrim(descripcion)) > 0 AND length(descripcion) <= 200),
  cantidad      numeric(14,3) NOT NULL CHECK (cantidad > 0),
  costo         numeric(14,2) NOT NULL CHECK (costo >= 0),           -- unitario, sin IVA
  iva           numeric(4,1) NOT NULL CHECK (iva IN (0, 10.5, 21, 27)),
  neto          numeric(14,2) NOT NULL,
  iva_monto     numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, nota_id) REFERENCES notas_credito_compra (tenant_id, id),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id)
);
CREATE INDEX ON nota_credito_compra_renglones (tenant_id, nota_id, orden);

CREATE FUNCTION app.proteger_nota_credito_compra() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las notas de crédito de proveedor no se borran: se anulan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'Una nota de crédito anulada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado <> 'anulada' OR NEW.anulada_en IS NULL
     OR (NEW.total, NEW.proveedor_id, NEW.numero, NEW.comprobante) IS DISTINCT FROM (OLD.total, OLD.proveedor_id, OLD.numero, OLD.comprobante) THEN
    RAISE EXCEPTION 'Una nota de crédito cerrada solo se puede anular' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notas_credito_compra_proteger BEFORE UPDATE OR DELETE ON notas_credito_compra FOR EACH ROW EXECUTE FUNCTION app.proteger_nota_credito_compra();

CREATE FUNCTION app.proteger_renglon_nota_credito_compra() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'Los renglones de una nota de crédito no se modifican ni se borran' USING ERRCODE = 'restrict_violation'; END $$;
CREATE TRIGGER nc_compra_renglones_proteger BEFORE UPDATE OR DELETE ON nota_credito_compra_renglones FOR EACH ROW EXECUTE FUNCTION app.proteger_renglon_nota_credito_compra();

-- ───────── Los libros de stock y de cuenta corriente reconocen la nota ─────────
ALTER TABLE stock_movimientos DROP CONSTRAINT stock_movimientos_tipo_check;
ALTER TABLE stock_movimientos ADD CONSTRAINT stock_movimientos_tipo_check
  CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','devolucion_venta','compra','elaboracion','devolucion_compra'));
ALTER TABLE stock_movimientos ADD COLUMN nota_credito_compra_id uuid, ADD FOREIGN KEY (tenant_id, nota_credito_compra_id) REFERENCES notas_credito_compra (tenant_id, id);

ALTER TABLE cuenta_corriente_movimientos DROP CONSTRAINT cuenta_corriente_movimientos_tipo_check;
ALTER TABLE cuenta_corriente_movimientos ADD CONSTRAINT cuenta_corriente_movimientos_tipo_check
  CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','recibo','nota_credito','devolucion_pago','compra','orden_pago','nota_credito_compra'));
ALTER TABLE cuenta_corriente_movimientos ADD COLUMN nota_credito_compra_id uuid, ADD FOREIGN KEY (tenant_id, nota_credito_compra_id) REFERENCES notas_credito_compra (tenant_id, id);

-- ───────── Seguridad por comercio ─────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['notas_credito_compra','nota_credito_compra_renglones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON notas_credito_compra TO app_user;
GRANT SELECT, INSERT ON nota_credito_compra_renglones TO app_user;
GRANT USAGE ON SEQUENCE nota_credito_compra_renglones_id_seq TO app_user;
