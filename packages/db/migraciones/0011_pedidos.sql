-- 0011 · Pedidos de clientes: una venta abierta que se guarda para entregar más adelante.
-- Reutiliza ventas_abiertas (mismo ciclo: abierta → cerrada al convertirse en venta, o descartada al cancelarse).
-- Como todo borrador, no mueve caja, stock ni cuenta corriente hasta que se convierte en venta.

ALTER TABLE ventas_abiertas
  ADD COLUMN es_pedido boolean NOT NULL DEFAULT false,
  ADD COLUMN entrega   date;                       -- fecha de entrega prometida (opcional)

ALTER TABLE ventas_abiertas ADD CONSTRAINT entrega_solo_pedidos CHECK (es_pedido OR entrega IS NULL);
CREATE INDEX ON ventas_abiertas (tenant_id, entrega NULLS LAST, creado_en) WHERE estado = 'abierta' AND es_pedido;
