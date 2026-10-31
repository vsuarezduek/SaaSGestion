-- Productos: proveedor del producto y datos extras configurables por comercio.
-- Migración aditiva: no toca dinero, stock ni cuenta corriente.

-- Proveedor habitual del producto (para la modificación masiva, "productos del proveedor" y los informes).
ALTER TABLE productos
  ADD COLUMN proveedor_id uuid,
  ADD FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedores (tenant_id, id);
CREATE INDEX ON productos (tenant_id, proveedor_id) WHERE proveedor_id IS NOT NULL;

-- Datos extras: cada comercio define los suyos (por ejemplo "Lista mayorista" o "Ferias").
-- El valor de cada producto vive en productos.datos_extra, con el id del dato como clave; renombrar un dato no pierde valores.
-- "Quitar" un dato lo desactiva: los valores quedan guardados y vuelven si se reactiva.
CREATE TABLE datos_extra (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nombre    text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 60),
  orden     int  NOT NULL DEFAULT 0,
  activo    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX datos_extra_nombre_unico ON datos_extra (tenant_id, lower(nombre)) WHERE activo;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['datos_extra'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON datos_extra TO app_user;
