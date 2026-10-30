-- 0012 · Notas de crédito: devolución de mercadería de una venta.
-- Es una venta con comprobante 'nota_credito' (importes en positivo) que apunta a la venta de origen y cada renglón al renglón que devuelve.
-- Efectos (todos con movimientos nuevos en los libros, nada se edita ni se borra):
--   stock: suma lo devuelto ('devolucion_venta'); caja: sale la plata devuelta ('devolucion_venta', sin comisión);
--   cuenta corriente: baja la deuda del cliente ('nota_credito').

ALTER TABLE ventas ADD COLUMN venta_origen_id uuid;
ALTER TABLE ventas ADD FOREIGN KEY (tenant_id, venta_origen_id) REFERENCES ventas (tenant_id, id);
ALTER TABLE ventas ADD CONSTRAINT origen_solo_nota_credito CHECK (venta_origen_id IS NULL OR comprobante = 'nota_credito');
CREATE INDEX ON ventas (tenant_id, venta_origen_id) WHERE venta_origen_id IS NOT NULL;

ALTER TABLE venta_renglones ADD COLUMN renglon_origen_id bigint REFERENCES venta_renglones (id);
CREATE INDEX ON venta_renglones (renglon_origen_id) WHERE renglon_origen_id IS NOT NULL;

ALTER TABLE cuenta_corriente_movimientos DROP CONSTRAINT cuenta_corriente_movimientos_tipo_check;
ALTER TABLE cuenta_corriente_movimientos ADD CONSTRAINT cuenta_corriente_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','recibo','nota_credito'));

ALTER TABLE stock_movimientos DROP CONSTRAINT stock_movimientos_tipo_check;
ALTER TABLE stock_movimientos ADD CONSTRAINT stock_movimientos_tipo_check CHECK (tipo IN ('saldo_inicial','ajuste','reversion','venta','devolucion_venta'));

ALTER TABLE caja_movimientos DROP CONSTRAINT caja_movimientos_tipo_check;
ALTER TABLE caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_check CHECK (tipo IN ('ingreso','egreso','transferencia_salida','transferencia_entrada',
  'apertura_diferencia','cierre_diferencia','traspaso_salida','traspaso_entrada','reversion','cobro_venta','comision_venta','cobro_recibo','comision_recibo','devolucion_venta'));
