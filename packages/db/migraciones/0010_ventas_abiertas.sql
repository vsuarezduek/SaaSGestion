-- 0010 · Ventas abiertas: borradores de venta que se guardan solos y cualquier usuario del comercio puede retomar.
-- No son un libro contable: no mueven caja, stock ni cuenta corriente hasta que se cierran (ahí nace la venta real).
-- Se editan con control de versión (si dos personas tocan la misma, la segunda se entera en vez de pisar a la primera).

CREATE TABLE ventas_abiertas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  estado        text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada','descartada')),
  version       int  NOT NULL DEFAULT 1,
  cliente_id    uuid NOT NULL,
  datos         jsonb NOT NULL,                                     -- el formulario tal como está cargado
  renglones     int  NOT NULL DEFAULT 0 CHECK (renglones >= 0),
  total         numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),   -- estimado, solo para mostrar en la lista
  creada_por    uuid,
  modificada_por uuid,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  modificado_en timestamptz NOT NULL DEFAULT now(),
  venta_id      uuid,                                               -- la venta que nació al cerrarla
  cerrada_en    timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id),
  FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas (tenant_id, id),
  CHECK ((estado = 'cerrada') = (venta_id IS NOT NULL))
);
CREATE INDEX ON ventas_abiertas (tenant_id, modificado_en DESC) WHERE estado = 'abierta';

-- Una vez cerrada o descartada, no se toca más; y nunca se borra.
CREATE FUNCTION app.proteger_venta_abierta() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las ventas abiertas no se borran: se descartan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado <> 'abierta' THEN
    RAISE EXCEPTION 'Una venta abierta cerrada o descartada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ventas_abiertas_proteger BEFORE UPDATE OR DELETE ON ventas_abiertas FOR EACH ROW EXECUTE FUNCTION app.proteger_venta_abierta();

ALTER TABLE ventas_abiertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_abiertas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON ventas_abiertas USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE ON ventas_abiertas TO app_user;
