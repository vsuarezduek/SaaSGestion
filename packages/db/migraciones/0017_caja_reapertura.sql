-- 0017 · Reapertura de caja: un turno nuevo que continúa a uno cerrado el mismo día (aditiva).
-- El turno cerrado no se toca (lo protege el trigger); la reapertura deja su motivo y a qué cierre corresponde.
ALTER TABLE caja_turnos
  ADD COLUMN reabre_turno_id   uuid,
  ADD COLUMN reapertura_motivo text CHECK (reapertura_motivo IS NULL OR (length(btrim(reapertura_motivo)) > 0 AND length(reapertura_motivo) <= 200)),
  ADD CONSTRAINT caja_turnos_reabre_fk FOREIGN KEY (tenant_id, reabre_turno_id) REFERENCES caja_turnos (tenant_id, id),
  ADD CONSTRAINT caja_turnos_reabre_motivo CHECK ((reabre_turno_id IS NULL) = (reapertura_motivo IS NULL));
-- Un cierre se reabre una sola vez (si se vuelve a cerrar, se reabre el nuevo cierre).
CREATE UNIQUE INDEX caja_turno_reabierto_unico ON caja_turnos (tenant_id, reabre_turno_id) WHERE reabre_turno_id IS NOT NULL;
