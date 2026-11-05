-- 0024 · Compras abiertas: borradores de compra que cualquier usuario del comercio puede retomar. Aditiva.
-- No son un libro contable: no mueven caja, stock ni cuenta corriente hasta que se cierran (ahí nace la compra real).
-- Se editan con control de versión; una vez cerradas o descartadas no se tocan y nunca se borran.
CREATE TABLE compras_abiertas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  estado         text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada','descartada')),
  version        int  NOT NULL DEFAULT 1,
  proveedor_id   uuid NOT NULL,
  datos          jsonb NOT NULL,
  renglones      int  NOT NULL DEFAULT 0 CHECK (renglones >= 0),
  total          numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),   -- estimado, solo para mostrar en la lista
  creada_por     uuid,
  modificada_por uuid,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  modificado_en  timestamptz NOT NULL DEFAULT now(),
  compra_id      uuid,
  cerrada_en     timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedores (tenant_id, id),
  FOREIGN KEY (tenant_id, compra_id) REFERENCES compras (tenant_id, id),
  CHECK ((estado = 'cerrada') = (compra_id IS NOT NULL))
);
CREATE INDEX ON compras_abiertas (tenant_id, modificado_en DESC) WHERE estado = 'abierta';

CREATE FUNCTION app.proteger_compra_abierta() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las compras abiertas no se borran: se descartan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado <> 'abierta' THEN
    RAISE EXCEPTION 'Una compra abierta cerrada o descartada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compras_abiertas_proteger BEFORE UPDATE OR DELETE ON compras_abiertas FOR EACH ROW EXECUTE FUNCTION app.proteger_compra_abierta();

ALTER TABLE compras_abiertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_abiertas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON compras_abiertas USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE ON compras_abiertas TO app_user;
