-- 0026 · Mercadería a pedir fuera del catálogo (D-041): en el «Pedido de mercadería pendiente» del Inicio se puede anotar,
-- como texto, algo que no está cargado como producto, con cantidad y proveedor opcionales. Aditiva.
-- No es un libro contable: no mueve stock, caja ni cuenta corriente. Se quita marcándola (nunca se borra) para que quede el rastro.
CREATE TABLE mercaderia_a_pedir (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  descripcion   text NOT NULL CHECK (length(btrim(descripcion)) BETWEEN 1 AND 200),
  cantidad      numeric(14,3) CHECK (cantidad IS NULL OR cantidad > 0),
  proveedor_id  uuid,
  estado        text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','quitada')),
  creado_por    uuid,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  quitada_por   uuid,
  quitada_en    timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedores (tenant_id, id),
  CHECK ((estado = 'quitada') = (quitada_en IS NOT NULL))
);
CREATE INDEX ON mercaderia_a_pedir (tenant_id, creado_en) WHERE estado = 'pendiente';

CREATE FUNCTION app.proteger_mercaderia_a_pedir() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La mercadería a pedir no se borra: se quita' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Una mercadería ya quitada no se modifica' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mercaderia_a_pedir_proteger BEFORE UPDATE OR DELETE ON mercaderia_a_pedir FOR EACH ROW EXECUTE FUNCTION app.proteger_mercaderia_a_pedir();

ALTER TABLE mercaderia_a_pedir ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercaderia_a_pedir FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON mercaderia_a_pedir USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE ON mercaderia_a_pedir TO app_user;
