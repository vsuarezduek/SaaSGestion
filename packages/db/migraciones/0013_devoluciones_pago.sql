-- 0013 · Devolución de pago: se le devuelve plata a un cliente que tiene saldo a favor en su cuenta corriente.
-- Es el espejo del recibo: sale plata de una caja y sube el saldo del cliente (acerca a cero un saldo a favor).
-- Una devolución cerrada no se edita: solo puede pasar a 'anulada' (la anulación revierte sus movimientos con el inverso).

CREATE TABLE devoluciones_pago (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  numero           int  NOT NULL CHECK (numero > 0),                 -- correlativo por comercio
  estado           text NOT NULL DEFAULT 'cerrada' CHECK (estado IN ('cerrada','anulada')),
  clave            uuid,                                             -- evita registrar dos veces la misma devolución (doble clic)
  cliente_id       uuid NOT NULL,
  fecha            timestamptz NOT NULL DEFAULT now(),
  importe          numeric(14,2) NOT NULL CHECK (importe > 0),
  medio_pago_id    uuid NOT NULL,
  caja_id          uuid NOT NULL,
  nota             text CHECK (nota IS NULL OR length(nota) <= 500),
  usuario_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      uuid,
  motivo_anulacion text CHECK (motivo_anulacion IS NULL OR length(motivo_anulacion) <= 200),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id),
  FOREIGN KEY (tenant_id, medio_pago_id) REFERENCES medios_pago (tenant_id, id),
  FOREIGN KEY (tenant_id, caja_id) REFERENCES cajas (tenant_id, id)
);
CREATE UNIQUE INDEX devoluciones_pago_clave_unica ON devoluciones_pago (tenant_id, clave) WHERE clave IS NOT NULL;
CREATE INDEX ON devoluciones_pago (tenant_id, cliente_id, creado_en DESC);

CREATE FUNCTION app.proteger_devolucion_pago() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las devoluciones de pago no se borran: se anulan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'Una devolución anulada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado <> 'anulada' OR NEW.anulada_en IS NULL
     OR (NEW.importe, NEW.cliente_id, NEW.numero, NEW.caja_id, NEW.medio_pago_id)
        IS DISTINCT FROM (OLD.importe, OLD.cliente_id, OLD.numero, OLD.caja_id, OLD.medio_pago_id) THEN
    RAISE EXCEPTION 'Una devolución cerrada solo se puede anular' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER devoluciones_pago_proteger BEFORE UPDATE OR DELETE ON devoluciones_pago FOR EACH ROW EXECUTE FUNCTION app.proteger_devolucion_pago();

-- ───────── Los libros reconocen las devoluciones ─────────
ALTER TABLE cuenta_corriente_movimientos DROP CONSTRAINT cuenta_corriente_movimientos_tipo_check;
ALTER TABLE cuenta_corriente_movimientos ADD CONSTRAINT cuenta_corriente_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','recibo','nota_credito','devolucion_pago'));
ALTER TABLE cuenta_corriente_movimientos ADD COLUMN devolucion_id uuid, ADD FOREIGN KEY (tenant_id, devolucion_id) REFERENCES devoluciones_pago (tenant_id, id);

ALTER TABLE caja_movimientos DROP CONSTRAINT caja_movimientos_tipo_check;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_check CHECK (tipo IN ('ingreso','egreso','transferencia_salida','transferencia_entrada',
  'apertura_diferencia','cierre_diferencia','traspaso_salida','traspaso_entrada','reversion','cobro_venta','comision_venta','cobro_recibo','comision_recibo','devolucion_venta','devolucion_pago'));
ALTER TABLE caja_movimientos ADD COLUMN devolucion_id uuid, ADD FOREIGN KEY (tenant_id, devolucion_id) REFERENCES devoluciones_pago (tenant_id, id);

-- ───────── Seguridad por comercio ─────────
ALTER TABLE devoluciones_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones_pago FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON devoluciones_pago USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE ON devoluciones_pago TO app_user;
