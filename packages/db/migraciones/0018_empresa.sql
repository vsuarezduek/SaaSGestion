-- 0018 · Datos de la empresa y marca visual (logo y color) por comercio. Aditiva.
-- El logo se guarda en la base (PNG o JPEG, hasta 300 KB): no hay servicio de archivos y no se acepta SVG (puede llevar scripts).
CREATE TABLE empresa (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id),
  razon_social   text CHECK (razon_social IS NULL OR length(razon_social) <= 120),
  cuit           text CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$'),
  condicion_iva  text CHECK (condicion_iva IS NULL OR length(condicion_iva) <= 40),
  domicilio      text CHECK (domicilio IS NULL OR length(domicilio) <= 160),
  localidad      text CHECK (localidad IS NULL OR length(localidad) <= 80),
  telefono       text CHECK (telefono IS NULL OR length(telefono) <= 40),
  email          text CHECK (email IS NULL OR length(email) <= 120),
  web            text CHECK (web IS NULL OR length(web) <= 120),
  color          text NOT NULL DEFAULT '#1c9764' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  logo           bytea,
  logo_tipo      text CHECK (logo_tipo IS NULL OR logo_tipo IN ('image/png', 'image/jpeg')),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK ((logo IS NULL) = (logo_tipo IS NULL)),
  CHECK (logo IS NULL OR octet_length(logo) <= 300000)
);
ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON empresa USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE ON empresa TO app_user;
