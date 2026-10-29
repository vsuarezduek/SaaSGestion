-- 0005 · Clientes, proveedores, categorías de cliente y libro de cuenta corriente.
-- Los saldos NO se guardan: se calculan sumando movimientos. El libro es de solo agregado:
-- corregir = un movimiento inverso que referencia al original.
-- Saldo positivo = el cliente nos debe / nosotros debemos al proveedor.

CREATE TABLE categorias_cliente (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  nombre         text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 60),
  lista_id       uuid,                                  -- lista de precios por defecto
  cuenta_corriente boolean NOT NULL DEFAULT false,
  descuento      numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0 AND descuento <= 100),
  venta_a_costo  boolean NOT NULL DEFAULT false,
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lista_id) REFERENCES listas_precios (tenant_id, id)
);
CREATE UNIQUE INDEX categorias_cliente_nombre_unico ON categorias_cliente (tenant_id, lower(nombre));

CREATE TABLE clientes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  nombre             text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 200),
  categoria_id       uuid,
  telefono           text CHECK (telefono IS NULL OR length(telefono) <= 40),
  email              text CHECK (email IS NULL OR (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+$')),
  domicilio          text CHECK (domicilio IS NULL OR length(domicilio) <= 200),
  localidad          text CHECK (localidad IS NULL OR length(localidad) <= 100),
  cuit               text CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$'),
  condicion_iva      text NOT NULL DEFAULT 'consumidor_final'
                     CHECK (condicion_iva IN ('consumidor_final','responsable_inscripto','monotributo','exento')),
  es_consumidor_final boolean NOT NULL DEFAULT false,  -- cliente genérico de mostrador (uno por comercio)
  activo             boolean NOT NULL DEFAULT true,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  modificado_en      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, categoria_id) REFERENCES categorias_cliente (tenant_id, id)
);
CREATE UNIQUE INDEX clientes_consumidor_final ON clientes (tenant_id) WHERE es_consumidor_final;
CREATE INDEX ON clientes (tenant_id, activo);

CREATE TABLE proveedores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  nombre        text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 200),
  contacto      text CHECK (contacto IS NULL OR length(contacto) <= 120),
  categoria     text CHECK (categoria IS NULL OR length(categoria) <= 60),
  telefono      text CHECK (telefono IS NULL OR length(telefono) <= 40),
  email         text CHECK (email IS NULL OR (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+$')),
  domicilio     text CHECK (domicilio IS NULL OR length(domicilio) <= 200),
  localidad     text CHECK (localidad IS NULL OR length(localidad) <= 100),
  cuit          text CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$'),
  condicion_iva text CHECK (condicion_iva IS NULL OR condicion_iva IN ('responsable_inscripto','monotributo','exento','consumidor_final')),
  activo        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  modificado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX ON proveedores (tenant_id, activo);

CREATE TRIGGER clientes_modificado BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION app.tocar_modificado();
CREATE TRIGGER proveedores_modificado BEFORE UPDATE ON proveedores FOR EACH ROW EXECUTE FUNCTION app.tocar_modificado();

-- ───────── Libro de cuenta corriente (solo agregar) ─────────
CREATE TABLE cuenta_corriente_movimientos (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  cliente_id   uuid,
  proveedor_id uuid,
  tipo         text NOT NULL CHECK (tipo IN ('saldo_inicial','ajuste','reversion')),
  importe      numeric(14,2) NOT NULL CHECK (importe <> 0),   -- + aumenta la deuda, − la reduce
  concepto     text CHECK (concepto IS NULL OR length(concepto) <= 200),
  revierte_id  bigint,                                        -- movimiento que este anula
  usuario_id   uuid,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((cliente_id IS NULL) <> (proveedor_id IS NULL)),     -- de un cliente o de un proveedor, no de ambos
  CHECK ((tipo = 'reversion') = (revierte_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, cliente_id)   REFERENCES clientes (tenant_id, id),
  FOREIGN KEY (tenant_id, proveedor_id) REFERENCES proveedores (tenant_id, id),
  FOREIGN KEY (tenant_id, revierte_id)  REFERENCES cuenta_corriente_movimientos (tenant_id, id)
);
CREATE UNIQUE INDEX cc_una_reversion ON cuenta_corriente_movimientos (tenant_id, revierte_id) WHERE revierte_id IS NOT NULL;
CREATE INDEX ON cuenta_corriente_movimientos (tenant_id, cliente_id, creado_en DESC) WHERE cliente_id IS NOT NULL;
CREATE INDEX ON cuenta_corriente_movimientos (tenant_id, proveedor_id, creado_en DESC) WHERE proveedor_id IS NOT NULL;

CREATE TRIGGER cc_solo_agregar BEFORE UPDATE OR DELETE ON cuenta_corriente_movimientos
  FOR EACH ROW EXECUTE FUNCTION app.solo_agregar();
CREATE TRIGGER cc_no_truncar BEFORE TRUNCATE ON cuenta_corriente_movimientos
  FOR EACH STATEMENT EXECUTE FUNCTION app.solo_agregar();

-- ───────── Seguridad por comercio ─────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['categorias_cliente','clientes','proveedores','cuenta_corriente_movimientos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON categorias_cliente, clientes, proveedores TO app_user;
GRANT SELECT, INSERT ON cuenta_corriente_movimientos TO app_user;
GRANT USAGE ON SEQUENCE cuenta_corriente_movimientos_id_seq TO app_user;
