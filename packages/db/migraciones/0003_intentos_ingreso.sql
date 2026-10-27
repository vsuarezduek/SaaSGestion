-- 0003 · Intentos de ingreso, para limitar los intentos fallidos (fuerza bruta) por comercio.
-- No es un libro contable: se pueden borrar los intentos de un usuario cuando entra bien.
-- La IP se guarda como hash (no en claro).
CREATE TABLE intentos_ingreso (
  id        bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email     citext NOT NULL,
  ip_hash   text   NOT NULL,
  exito     boolean NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON intentos_ingreso (tenant_id, email, creado_en DESC);
CREATE INDEX ON intentos_ingreso (tenant_id, ip_hash, creado_en DESC);
ALTER TABLE intentos_ingreso ENABLE ROW LEVEL SECURITY;
ALTER TABLE intentos_ingreso FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON intentos_ingreso
  USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, DELETE ON intentos_ingreso TO app_user;
GRANT USAGE ON SEQUENCE intentos_ingreso_id_seq TO app_user;
