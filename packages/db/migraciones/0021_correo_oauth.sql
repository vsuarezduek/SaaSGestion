-- 0021 · Envío de comprobantes por mail desde la casilla del comercio (Gmail u Outlook por OAuth). Aditiva.
-- La conexión guarda solo el token de renovación, CIFRADO (AES-256-GCM, atado al comercio); nunca la contraseña de la casilla.
CREATE TABLE correo_conexion (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id),
  proveedor      text NOT NULL CHECK (proveedor IN ('google', 'microsoft')),
  cuenta         text NOT NULL CHECK (length(cuenta) BETWEEN 3 AND 200),
  token_cifrado  text NOT NULL CHECK (length(token_cifrado) BETWEEN 20 AND 4000),
  conectado_por  uuid REFERENCES usuarios(id),
  conectado_en   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE correo_conexion ENABLE ROW LEVEL SECURITY;
ALTER TABLE correo_conexion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON correo_conexion USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON correo_conexion TO app_user;

-- Registro de envíos: solo se agrega (sin UPDATE ni DELETE para la aplicación). Sirve para auditar y limitar la cantidad por hora.
CREATE TABLE correo_envios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  usuario_id  uuid REFERENCES usuarios(id),
  tipo        text NOT NULL CHECK (tipo IN ('venta', 'compra')),
  entidad_id  uuid NOT NULL,
  para        text NOT NULL CHECK (length(para) <= 200),
  asunto      text NOT NULL CHECK (length(asunto) <= 300),
  resultado   text NOT NULL CHECK (resultado IN ('enviado', 'error')),
  detalle     text CHECK (detalle IS NULL OR length(detalle) <= 500),
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX correo_envios_tenant_creado ON correo_envios (tenant_id, creado_en DESC);
ALTER TABLE correo_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE correo_envios FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON correo_envios USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
GRANT SELECT, INSERT ON correo_envios TO app_user;
