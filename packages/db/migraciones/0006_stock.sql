-- 0006 · Stock: libro de movimientos de solo agregar. El stock actual NO se guarda: es la suma de movimientos.
-- Corregir = un movimiento inverso que referencia al original. El stock puede quedar negativo (la aplicación lo alerta).
ALTER TABLE productos
  ADD COLUMN stock_minimo numeric(14,3) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  ADD COLUMN stock_ideal  numeric(14,3) NOT NULL DEFAULT 0 CHECK (stock_ideal >= 0);

CREATE TABLE stock_movimientos (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  producto_id uuid NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('saldo_inicial','ajuste','reversion')),
  cantidad    numeric(14,3) NOT NULL CHECK (cantidad <> 0),   -- + entra, − sale
  concepto    text CHECK (concepto IS NULL OR length(concepto) <= 200),
  revierte_id bigint,
  usuario_id  uuid,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((tipo = 'reversion') = (revierte_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id),
  FOREIGN KEY (tenant_id, revierte_id) REFERENCES stock_movimientos (tenant_id, id)
);
CREATE UNIQUE INDEX stock_una_reversion ON stock_movimientos (tenant_id, revierte_id) WHERE revierte_id IS NOT NULL;
CREATE INDEX ON stock_movimientos (tenant_id, producto_id, id DESC);

CREATE TRIGGER stock_solo_agregar BEFORE UPDATE OR DELETE ON stock_movimientos
  FOR EACH ROW EXECUTE FUNCTION app.solo_agregar();
CREATE TRIGGER stock_no_truncar BEFORE TRUNCATE ON stock_movimientos
  FOR EACH STATEMENT EXECUTE FUNCTION app.solo_agregar();

ALTER TABLE stock_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movimientos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON stock_movimientos USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT ON stock_movimientos TO app_user;
GRANT USAGE ON SEQUENCE stock_movimientos_id_seq TO app_user;
