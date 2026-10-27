-- 0002 · La conexión (dueño de las tablas) puede pasar a actuar como app_user con SET ROLE.
-- En bases administradas (p. ej. Neon) quien crea un rol no puede cambiarse a él sin una concesión explícita
-- con la opción SET (PostgreSQL 16 en adelante). La aplicación usa SET LOCAL ROLE app_user dentro de cada
-- transacción para que se aplique Row Level Security.
DO $$ BEGIN
  IF current_user <> 'app_user' THEN
    IF current_setting('server_version_num')::int >= 160000 THEN
      EXECUTE format('GRANT app_user TO %I WITH SET TRUE, INHERIT FALSE', current_user);
    ELSE
      EXECUTE format('GRANT app_user TO %I', current_user);
    END IF;
  END IF;
END $$;
