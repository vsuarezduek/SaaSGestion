-- 0019 · Orden de las cajas de cada medio de pago: la primera es la que se elige sola al cobrar (aditiva).
ALTER TABLE medio_pago_cajas ADD COLUMN orden int NOT NULL DEFAULT 0;
