import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aCentavos, deCentavos, normalizarImporte, formatearPesos,
  precioDesdeUtilidad, utilidadDesdePrecio, precioMantenerUtilidad, ivaIncluido, esAlicuotaValida,
  plegar, terminosDeBusqueda, escaparLike, calcularCompra, impuestoDeTransaccion, ajustarCosto,
} from '../src/index.ts';

test('importes: de texto a centavos y de vuelta, sin decimales de coma flotante', () => {
  assert.equal(aCentavos('1234.5'), 123450);
  assert.equal(aCentavos('0.07'), 7);
  assert.equal(aCentavos('-10'), -1000);
  assert.equal(deCentavos(123450), '1234.50');
  assert.equal(deCentavos(-7), '-0.07');
  assert.equal(aCentavos('0.1') + aCentavos('0.2'), aCentavos('0.3')); // lo que con float falla
  assert.throws(() => aCentavos('1,5'));
  assert.throws(() => aCentavos('1.234'));
  assert.throws(() => deCentavos(1.5));
});

test('importes escritos por personas se normalizan', () => {
  assert.equal(normalizarImporte('1.234,50'), '1234.50');
  assert.equal(normalizarImporte('1234,5'), '1234.50');
  assert.equal(normalizarImporte('$ 1.234'), '1234.00');
  assert.equal(normalizarImporte('1.234.567'), '1234567.00');
  assert.equal(normalizarImporte('abc'), null);
  assert.equal(normalizarImporte(''), null);
  assert.equal(normalizarImporte('1,234'), null); // 3 decimales: no se adivina
});

test('formato en pesos argentinos', () => {
  assert.equal(formatearPesos(123450), '$ 1.234,50');
  assert.equal(formatearPesos(5), '$ 0,05');
  assert.equal(formatearPesos(-100000), '-$ 1.000,00');
  assert.equal(formatearPesos(123456789), '$ 1.234.567,89');
});

test('precio desde costo, utilidad e IVA', () => {
  assert.equal(precioDesdeUtilidad(10000, 40, 21), 16940); // 100 × 1,40 × 1,21
  assert.equal(precioDesdeUtilidad(10000, 0, 21), 12100);
  assert.equal(precioDesdeUtilidad(10000, 40, 0), 14000);
  assert.equal(precioDesdeUtilidad(0, 40, 21), 0);
  assert.equal(precioDesdeUtilidad(10000, 40.5, 10.5), 15525); // 100 × 1,405 × 1,105 = 155,2525 → 155,25
});

test('redondeo mitad hacia arriba al centavo', () => {
  // 1 centavo de costo, 50% de utilidad, sin IVA → 1,5 → 2
  assert.equal(precioDesdeUtilidad(1, 50, 0), 2);
  // 3 centavos × 1,5 = 4,5 → 5
  assert.equal(precioDesdeUtilidad(3, 50, 0), 5);
  // 1 centavo × 1,49 = 1,49 → 1
  assert.equal(precioDesdeUtilidad(1, 49, 0), 1);
});

test('utilidad desde precio es la inversa de precio desde utilidad', () => {
  for (const iva of [0, 10.5, 21, 27]) {
    for (const costo of [100, 1999, 12345, 987654]) {
      for (const u of [0, 10, 25.5, 40, 100]) {
        const precio = precioDesdeUtilidad(costo, u, iva);
        const u2 = utilidadDesdePrecio(costo, precio, iva)!;
        // el redondeo al centavo puede mover la utilidad una pizca; nunca más de lo que mueve 1 centavo
        const tolerancia = (100 / costo) * 100 * 1.0 / (1 + iva / 100) + 0.01;
        assert.ok(Math.abs(u2 - u) <= tolerancia, `costo ${costo} u ${u} iva ${iva}: ${u2}`);
      }
    }
  }
  assert.equal(utilidadDesdePrecio(10000, 16940, 21), 40);
  assert.equal(utilidadDesdePrecio(0, 100, 21), null);
});

test('mantener utilidad cuando cambia el costo', () => {
  assert.equal(precioMantenerUtilidad(16940, 10000, 12000), 20328);
  assert.equal(precioMantenerUtilidad(16940, 0, 12000), 16940); // sin costo previo no hay proporción
  assert.equal(precioMantenerUtilidad(100, 3, 4), 133); // 133,33 → 133
});

test('IVA incluido en un precio final', () => {
  assert.equal(ivaIncluido(12100, 21), 2100);
  assert.equal(ivaIncluido(11050, 10.5), 1050);
  assert.equal(ivaIncluido(5000, 0), 0);
  assert.equal(ivaIncluido(1000, 21), 174); // 173,55 → 174
});

test('alícuotas de IVA permitidas', () => {
  assert.ok(esAlicuotaValida(21));
  assert.ok(esAlicuotaValida(10.5));
  assert.ok(!esAlicuotaValida(5));
  assert.throws(() => precioDesdeUtilidad(100, 10, 5));
  assert.throws(() => precioDesdeUtilidad(-1, 10, 21));
});

test('búsqueda: sin tildes, sin mayúsculas, singular/plural y cualquier orden', () => {
  assert.equal(plegar('  PÁN  de   Molde Ñandú '), 'pan de molde nandu');
  assert.deepEqual(terminosDeBusqueda('Almendras  PELADAS'), ['almendra', 'pelada']);
  assert.deepEqual(terminosDeBusqueda('frutos secos'), ['fruto', 'seco']);
  assert.deepEqual(terminosDeBusqueda('panes'), ['pan']);
  assert.deepEqual(terminosDeBusqueda('té'), ['te']);
  assert.deepEqual(terminosDeBusqueda('   '), []);
  assert.equal(terminosDeBusqueda('a b c d e f g h i j k').length, 8);
  assert.equal(escaparLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('cantidades: hasta 3 decimales, coma decimal y formato sin ceros de más', async () => {
  const { normalizarCantidad, formatearCantidad, estadoStock } = await import('../src/index.ts');
  assert.equal(normalizarCantidad('12'), '12.000');
  assert.equal(normalizarCantidad('1,5'), '1.500');
  assert.equal(normalizarCantidad('1.5'), '1.500');
  assert.equal(normalizarCantidad('1.234,567'), '1234.567');
  assert.equal(normalizarCantidad('-3'), '-3.000');
  assert.equal(normalizarCantidad('1,2345'), null);
  assert.equal(normalizarCantidad('abc'), null);
  assert.equal(normalizarCantidad(''), null);
  assert.equal(formatearCantidad('12.500'), '12,5');
  assert.equal(formatearCantidad('-3.000'), '-3');
  assert.equal(formatearCantidad('1234.000'), '1.234');
  assert.equal(estadoStock('-1.000', '0.000'), 'negativo');
  assert.equal(estadoStock('2.000', '5.000'), 'bajo_minimo');
  assert.equal(estadoStock('0.000', '0.000'), 'normal');
  assert.equal(estadoStock('5.000', '5.000'), 'normal');
});

test('venta: descuentos por renglón y total, IVA incluido y redondeo al centavo', async () => {
  const { calcularVenta, comisionDeCobro } = await import('../src/index.ts');
  // 2 × $1.000 con 10 % → 1800; segundo renglón 1 × $500 sin descuento; descuento total 5 %
  const v = calcularVenta([
    { cantidad: '2', precio: 100000, descuentoPct: 10, iva: 21 },
    { cantidad: '1', precio: 50000, descuentoPct: 0, iva: 10.5 },
  ], 5);
  assert.deepEqual(v.renglones.map((r) => r.bruto), [200000, 50000]);
  assert.deepEqual(v.renglones.map((r) => r.subtotal), [180000, 50000]);
  assert.deepEqual(v.renglones.map((r) => r.total), [171000, 47500]);
  assert.equal(v.subtotal, 230000);
  assert.equal(v.total, 218500);
  assert.equal(v.descuentoTotal, 11500);
  assert.equal(v.renglones[0]!.iva, 29678); // 1710 × 21 ÷ 121 = 296,78
  assert.equal(v.ivaIncluido, v.renglones[0]!.iva + v.renglones[1]!.iva);
  // cantidades decimales: 1,5 kg × $333,33 = 499,995 → 500,00 (mitad hacia arriba)
  assert.equal(calcularVenta([{ cantidad: '1.500', precio: 33333, descuentoPct: 0, iva: 21 }], 0).total, 50000);
  // 0,333 × $10 = 3,33
  assert.equal(calcularVenta([{ cantidad: '0.333', precio: 1000, descuentoPct: 0, iva: 0 }], 0).total, 333);
  assert.equal(calcularVenta([], 0).total, 0);
  assert.throws(() => calcularVenta([{ cantidad: '1', precio: 100, descuentoPct: 101, iva: 21 }], 0));
  assert.throws(() => calcularVenta([{ cantidad: '1', precio: 100, descuentoPct: 0, iva: 21 }], -1));
  assert.throws(() => calcularVenta([{ cantidad: '1,5', precio: 100, descuentoPct: 0, iva: 21 }], 0));
  // comisión: 3 % + 21 % de IVA sobre $1.710 = 62,07
  assert.equal(comisionDeCobro(171000, 3, 21), 6207);
  assert.equal(comisionDeCobro(171000, 0, 21), 0);
  assert.equal(comisionDeCobro(100000, 1.5, 0), 1500);
});

test('venta: descuento total por monto reparte el descuento y cierra exacto en el total pedido', async () => {
  const { calcularVenta } = await import('../src/index.ts');
  const r = [
    { cantidad: '1', precio: 33333, descuentoPct: 0, iva: 21 },
    { cantidad: '1', precio: 33333, descuentoPct: 0, iva: 21 },
    { cantidad: '1', precio: 33334, descuentoPct: 0, iva: 21 },
  ]; // subtotal $1.000,00
  const v = calcularVenta(r, { totalFinal: 90000 });
  assert.equal(v.subtotal, 100000);
  assert.equal(v.total, 90000);                       // exacto, sin centavos perdidos
  assert.equal(v.descuentoTotal, 10000);
  assert.equal(v.renglones.reduce((a, x) => a + x.total, 0), 90000);
  // Un monto que no se reparte parejo (tres renglones iguales, $1 de descuento) sigue sumando exacto.
  const w = calcularVenta([{ cantidad: '1', precio: 1000, descuentoPct: 0, iva: 0 }, { cantidad: '1', precio: 1000, descuentoPct: 0, iva: 0 }, { cantidad: '1', precio: 1000, descuentoPct: 0, iva: 0 }], { totalFinal: 2999 });
  assert.equal(w.total, 2999);
  assert.deepEqual(w.renglones.map((x) => x.total), [999, 1000, 1000]); // el centavo va al primero (empate)
  // El porcentaje redondea renglón por renglón (puede diferir un centavo del monto pedido); por monto cierra exacto.
  assert.ok(Math.abs(calcularVenta(r, 10).total - 90000) <= 3);
  // Límites: total 0 (todo descontado), igual al subtotal (sin descuento), y errores.
  assert.equal(calcularVenta(r, { totalFinal: 0 }).total, 0);
  assert.equal(calcularVenta(r, { totalFinal: 100000 }).descuentoTotal, 0);
  assert.throws(() => calcularVenta(r, { totalFinal: 100001 }));
  assert.throws(() => calcularVenta(r, { totalFinal: -1 }));
  assert.throws(() => calcularVenta(r, { totalFinal: 10.5 }));
  assert.equal(calcularVenta([], { totalFinal: 0 }).total, 0);
});

test('compra: el costo es sin IVA y el IVA se suma solo si el comprobante lo discrimina', () => {
  const r = [{ cantidad: '10', costo: 10000, descuentoPct: 0, iva: 21 }];
  const sin = calcularCompra(r, 0, false);
  assert.deepEqual([sin.neto, sin.iva, sin.total], [100000, 0, 100000]);
  const con = calcularCompra(r, 0, true);
  assert.deepEqual([con.neto, con.iva, con.total], [100000, 21000, 121000]);
});

test('compra: descuento por renglón y descuento total, con redondeo al centavo', () => {
  const c = calcularCompra([{ cantidad: '2', costo: 10000, descuentoPct: 10, iva: 21 }], 10, true);
  assert.equal(c.renglones[0]!.subtotal, 18000);
  assert.equal(c.renglones[0]!.neto, 16200);
  assert.equal(c.descuentoTotal, 1800);
  assert.equal(c.iva, 3402);
  assert.equal(c.total, 19602);
  assert.equal(calcularCompra([{ cantidad: '0.333', costo: 100, descuentoPct: 0, iva: 21 }], 0, false).total, 33);   // 33,3 → 33
  assert.equal(calcularCompra([{ cantidad: '0.5', costo: 1, descuentoPct: 0, iva: 21 }], 0, false).total, 1);       // 0,5 → 1 (mitad hacia arriba)
});

test('compra: rechaza porcentajes, costos y cantidades inválidos', () => {
  assert.throws(() => calcularCompra([{ cantidad: '1', costo: 100, descuentoPct: 101, iva: 21 }], 0, false));
  assert.throws(() => calcularCompra([{ cantidad: '1', costo: 100, descuentoPct: 0, iva: 21 }], -1, false));
  assert.throws(() => calcularCompra([{ cantidad: '1', costo: 1.5, descuentoPct: 0, iva: 21 }], 0, false));
  assert.throws(() => calcularCompra([{ cantidad: 'x', costo: 100, descuentoPct: 0, iva: 21 }], 0, false));
});

test('impuesto por transacción: porcentaje del importe, mitad hacia arriba', () => {
  assert.equal(impuestoDeTransaccion(100000, 1.2), 1200);
  assert.equal(impuestoDeTransaccion(12345, 1.2), 148);   // 148,14
  assert.equal(impuestoDeTransaccion(100000, 0), 0);
  assert.throws(() => impuestoDeTransaccion(100, 101));
});

test('modificación masiva: porcentaje o importe, con redondeo y piso en cero', () => {
  assert.equal(ajustarCosto(10000, 'pct', 10), 11000);
  assert.equal(ajustarCosto(10000, 'pct', -10), 9000);
  assert.equal(ajustarCosto(1005, 'pct', 10), 1106);        // 100,5 → 1105,5 → mitad hacia arriba
  assert.equal(ajustarCosto(1005, 'pct', -10), 904);        // −100,5 → mitad lejos del cero
  assert.equal(ajustarCosto(10000, 'imp', 2550), 12550);
  assert.equal(ajustarCosto(10000, 'imp', -20000), 0);      // no baja de cero
  assert.equal(ajustarCosto(10000, 'pct', -100), 0);
  assert.equal(ajustarCosto(0, 'pct', 50), 0);
  assert.throws(() => ajustarCosto(100, 'imp', 1.5));
  assert.throws(() => ajustarCosto(-1, 'pct', 1));
});
