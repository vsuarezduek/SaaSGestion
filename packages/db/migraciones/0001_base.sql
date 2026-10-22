-- 0001 · Base: roles, contexto de comercio (tenant), comercios, usuarios, sesiones y auditoría.
-- Principios (ver CLAUDE.md): todo dato de negocio lleva tenant_id y está protegido por
-- Row Level Security; las tablas de libro (auditoría, y luego caja/stock/cuenta corriente) son append-only.

CREATE EXTENSION IF NOT EXISTS citext;

-- Rol con el que corre la aplicación: NO es dueño de las tablas, NO puede saltear RLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO app_user;

-- Comercio actual de la conexión/transacción. La aplicación lo fija con:
--   SELECT set_config('app.tenant_id', '<uuid>', true);   -- (true = solo dentro de la transacción)
-- Si no está fijado devuelve NULL y las políticas no dejan ver ni escribir nada.
CREATE FUNCTION app.tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION app.tenant_id() TO app_user;

-- Impide UPDATE y DELETE: para tablas de libro (solo se agregan filas).
CREATE FUNCTION app.solo_agregar() RETURNS trigger
  LANGUAGE plpgsql AS
$$ BEGIN
  RAISE EXCEPTION 'La tabla % es solo de agregado: no se permite % (corregir = agregar un movimiento inverso)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

-- ───────── Comercios ─────────
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  nombre     text   NOT NULL CHECK (length(btrim(nombre)) > 0),
  rubro      text   NOT NULL DEFAULT 'general',
  estado     text   NOT NULL DEFAULT 'prueba' CHECK (estado IN ('prueba','activo','atrasado','suspendido')),
  zona_horaria text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  creado_en  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON tenants
  USING (id = app.tenant_id()) WITH CHECK (id = app.tenant_id());

-- ───────── Usuarios (por comercio) ─────────
-- El comercio se identifica por el dominio (mistica.saasgestion.com.ar), así que el email
-- es único dentro de cada comercio; una misma persona en dos comercios tiene dos cuentas.
CREATE TABLE usuarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  email         citext,
  nombre        text   NOT NULL CHECK (length(btrim(nombre)) > 0),
  rol           text   NOT NULL DEFAULT 'atencion'
                CHECK (rol IN ('administrador','encargada','atencion','cocina','marketing')),
  permisos      text[] NOT NULL DEFAULT '{}',          -- extras: ajustes, informes, descargar, permisos
  cajas_visibles uuid[],                               -- NULL = todas
  password_hash text,                                  -- obligatorio solo para administrador
  pin_hash      text,                                  -- cambio rápido de operador en mostrador
  activo        boolean NOT NULL DEFAULT true,
  ultimo_ingreso timestamptz,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id),
  CHECK (rol <> 'administrador' OR password_hash IS NOT NULL)
);
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON usuarios
  USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());

-- ───────── Sesiones ─────────
CREATE TABLE sesiones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  usuario_id  uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,          -- se guarda el hash, nunca el token
  creada_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON sesiones (tenant_id, usuario_id);
ALTER TABLE sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON sesiones
  USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());

-- ───────── Auditoría (append-only) ─────────
CREATE TABLE auditoria (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  usuario_id  uuid,
  accion      text NOT NULL,               -- p. ej. 'crear', 'modificar', 'anular', 'ingresar'
  entidad     text NOT NULL,               -- p. ej. 'producto', 'venta', 'caja'
  entidad_id  text,
  antes       jsonb,
  despues     jsonb,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auditoria (tenant_id, creado_en DESC);
CREATE INDEX ON auditoria (tenant_id, entidad, entidad_id);
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_propio ON auditoria
  USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id());
CREATE TRIGGER auditoria_solo_agregar BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION app.solo_agregar();
CREATE TRIGGER auditoria_no_truncar BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION app.solo_agregar();

-- ───────── Permisos de la aplicación ─────────
GRANT SELECT, INSERT, UPDATE ON tenants, usuarios TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON sesiones TO app_user;
GRANT SELECT, INSERT ON auditoria TO app_user;
GRANT USAGE ON SEQUENCE auditoria_id_seq TO app_user;

-- ───────── Funciones de entrada (antes de saber el comercio) ─────────
-- Resolver el comercio por el subdominio/slug, sin exponer otros datos.
CREATE FUNCTION app.tenant_por_slug(p_slug text)
RETURNS TABLE (id uuid, nombre text, estado text, zona_horaria text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT t.id, t.nombre, t.estado, t.zona_horaria FROM tenants t WHERE t.slug = p_slug::citext $$;
REVOKE ALL ON FUNCTION app.tenant_por_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tenant_por_slug(text) TO app_user;

-- Alta de un comercio nuevo con su administrador, en una sola transacción.
CREATE FUNCTION app.crear_comercio(
  p_slug text, p_nombre text, p_rubro text,
  p_admin_email text, p_admin_nombre text, p_admin_password_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE v_id uuid := gen_random_uuid(); v_user uuid;
BEGIN
  PERFORM set_config('app.tenant_id', v_id::text, true);
  INSERT INTO tenants (id, slug, nombre, rubro) VALUES (v_id, p_slug, p_nombre, COALESCE(p_rubro,'general'));
  INSERT INTO usuarios (tenant_id, email, nombre, rol, password_hash)
    VALUES (v_id, p_admin_email, p_admin_nombre, 'administrador', p_admin_password_hash)
    RETURNING id INTO v_user;
  INSERT INTO auditoria (tenant_id, usuario_id, accion, entidad, entidad_id, despues)
    VALUES (v_id, v_user, 'crear', 'comercio', v_id::text, jsonb_build_object('slug', p_slug, 'nombre', p_nombre));
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.crear_comercio(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.crear_comercio(text,text,text,text,text,text) TO app_user;
