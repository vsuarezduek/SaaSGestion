-- 0022 · El logo de la empresa puede pesar hasta 1 MB (antes 300 KB). Se reemplaza solo la restricción de tamaño; no se toca ningún dato.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'empresa'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%octet_length(logo)%'
  LOOP
    EXECUTE format('ALTER TABLE empresa DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE empresa ADD CONSTRAINT empresa_logo_tamano CHECK (logo IS NULL OR octet_length(logo) <= 1000000);
