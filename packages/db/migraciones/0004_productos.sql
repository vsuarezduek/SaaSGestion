-- 0004 · Catálogo: rubros (árbol), listas de precios, productos y sus precios.
-- Sin stock todavía: el stock es un libro de solo agregado y va en su propia migración.
-- Los productos no se borran: se archivan (activo = false) y conservan su historial.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ───────── Rubros (árbol) ─────────
CREATE TABLE rubros (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nombre    text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 120),
  padre_id  uuid,
  activo    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, padre_id) REFERENCES rubros (tenant_id, id),
  CHECK (padre_id IS NULL OR padre_id <> id)
);
CREATE UNIQUE INDEX rubros_nombre_unico ON rubros (tenant_id, COALESCE(padre_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nombre));

-- ───────── Listas de precios (configurables por comercio) ─────────
CREATE TABLE listas_precios (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nombre    text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 60),
  orden     int  NOT NULL DEFAULT 0,
  activa    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX listas_precios_nombre_unico ON listas_precios (tenant_id, lower(nombre));

-- ───────── Productos ─────────
CREATE TABLE productos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  codigo        text CHECK (codigo IS NULL OR (length(btrim(codigo)) > 0 AND length(codigo) <= 40)),
  nombre        text NOT NULL CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 200),
  rubro_id      uuid,
  tipo          text CHECK (tipo IS NULL OR length(tipo) <= 60),     -- tipo de producto (configurable por comercio)
  unidad        text NOT NULL DEFAULT 'unidad' CHECK (length(unidad) BETWEEN 1 AND 20),
  costo         numeric(14,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),  -- sin IVA
  iva           numeric(4,1)  NOT NULL DEFAULT 21 CHECK (iva IN (0, 10.5, 21, 27)),
  vendible      boolean NOT NULL DEFAULT true,
  comprable     boolean NOT NULL DEFAULT true,
  integrable    boolean NOT NULL DEFAULT true,   -- puede ser ingrediente de otro producto
  publicado_web boolean NOT NULL DEFAULT false,
  url_web       text CHECK (url_web IS NULL OR url_web ~ '^https?://'),
  datos_extra   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(datos_extra) = 'object'),
  activo        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  modificado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, rubro_id) REFERENCES rubros (tenant_id, id)
);
CREATE UNIQUE INDEX productos_codigo_unico ON productos (tenant_id, lower(codigo)) WHERE codigo IS NOT NULL;
CREATE INDEX ON productos (tenant_id, rubro_id);
CREATE INDEX ON productos (tenant_id, activo);

-- Precio final (con IVA) de cada producto en cada lista.
CREATE TABLE producto_precios (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  producto_id uuid NOT NULL,
  lista_id    uuid NOT NULL,
  precio      numeric(14,2) NOT NULL CHECK (precio >= 0),
  PRIMARY KEY (producto_id, lista_id),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES productos (tenant_id, id),
  FOREIGN KEY (tenant_id, lista_id) REFERENCES listas_precios (tenant_id, id)
);

CREATE FUNCTION app.tocar_modificado() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.modificado_en := now(); RETURN NEW; END $$;
CREATE TRIGGER productos_modificado BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION app.tocar_modificado();

-- ───────── Seguridad por comercio ─────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['rubros','listas_precios','productos','producto_precios'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_propio ON %I USING (tenant_id = app.tenant_id()) WITH CHECK (tenant_id = app.tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON rubros, listas_precios, productos TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON producto_precios TO app_user;
