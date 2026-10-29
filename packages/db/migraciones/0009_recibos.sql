-- 0009 · Recibos de cuenta corriente: el cliente paga (total o parcialmente) lo que debe.
-- Un recibo cerrado no se edita: solo puede pasar a 'anulado' (la anulación revierte sus movimientos con el inverso).

CREATE TABLE recibos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  numero           int  NOT NULL CHECK (numero > 0),                 -- correlativo por comercio
  estado           text NOT NULL DEFAULT 'cerrado' CHECK (estado IN ('cerrado','anulado')),
  clave            uuid,                                             -- evita registrar dos veces el mismo recibo (doble clic)
  cliente_id       uuid NOT NULL,
  venta_id         uuid,                                             -- venta que se está pagando (informativo; el saldo es del cliente)
  fecha            timestamptz NOT NULL DEFAULT now(),
  importe          numeric(14,2) NOT NULL CHECK (importe > 0),
  medio_pago_id    uuid NOT NULL,
  caja_id          uuid NOT NULL,
  comision         numeric(14,2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
  nota             text CHECK (nota IS NULL OR length(nota) <= 500),
  usuario_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulado_en       timestamptz,
  anulado_por      uuid,
  motivo_anulacion text CHECK (motivo_anulacion IS NULL OR length(motivo_anulacion) <= 200),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id),
  FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas (tenant_id, id),
  FOREIGN KEY (tenant_id, medio_pago_id) REFERENCES medios_pago (tenant_id, id),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id)
);
CREATE UNIQUE INDEX recibos_clave_unica ON recibos (tenant_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX ON recibos (tenant_id, cliente_id, creado_en DESC);

CREATE FUNCTION app.proteger_recibo() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los recibos no se borran: se anulan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'anulado' THEN
    RAISE EXCEPTION 'Un recibo anulado no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado <> 'anulado' OR NEW.anulado_en IS NULL
     OR (NEW.importe, NEW.cliente_id, NEW.numero, NEW.comision, NEW.caja_id, NEW.medio_pago_id)
        IS DISTINCT FROM (OLD.importe, OLD.cliente_id, OLD.numero, OLD.comision, OLD.caja_id, OLD.medio_pago_id) THEN
    RAISE EXCEPTION 'Un recibo cerrado solo se puede anular' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recibos_proteger BEFORE UPDATE OR DELETE ON recibos FOR EACH ROW EXECUTE FUNCTION app.proteger_recibo();

-- ───────── Los libros reconocen los recibos ─────────
ALTER TABLE cuenta_corriente_movimientos DROP CONSTRAINT cuenta_corriente_movimientos_tipo_check;
ALTER TABLE cuenta_corriente_movimientos ADD CONSTRAINT cuenta_corriente_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','recibo'));
ALTER TABLE cuenta_corriente_movimientos ADD COLUMN recibo_id uuid, ADD FOREIGN KEY (tenant_id, recibo_id) REFERENCES recibos (tenant_id, id);

ALTER TABLE caja_movimientos DROP CONSTRAINT caja_movimientos_tipo_check;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_check CHECK (tipo IN ('ingreso','egreso','transferencia_salida','transferencia_entrada',
  'apertura_diferencia','cierre_diferencia','traspaso_salida','traspaso_entrada','reversion','cobro_venta','comision_venta','cobro_recibo','comision_recibo'));
ALTER TABLE caja_movimientos ADD COLUMN recibo_id uuid, ADD FOREIGN KEY (tenant_id, recibo_id) REFERENCES recibos (tenant_id, id);

-- ───────── Seguridad por comercio ─────────
ALTER TABLE recibos ENABLE ROW LEVEL SECURITY;
ALTER TABLE recibos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON recibos USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE ON recibos TO app_user;
