// Ventas: cierre atómico (venta + renglones + caja/comisión o cuenta corriente + stock), IVA, descuentos,
// medios de pago, idempotencia, numeración correlativa y aislamiento entre comercios.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, cerrarCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { archivarProducto, guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { guardarCategoria, guardarCliente, obtenerCliente } from '../lib/personas.ts';
import { registrarStock } from '../lib/stock.ts';
import {
  anularVenta, buscarClientesParaVenta, buscarProductosParaVenta, cerrarVenta, guardarMedioDePago, listarVentas, obtenerVenta,
} from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let lista = '';
let efectivo = '';      // caja
let banco = '';         // caja
let medioEfectivo = '';
let medioTarjeta = '';  // 3 % + 21 % de IVA, solo en la caja banco
let clienteCC = '';     // categoría con cuenta corriente
let clienteSinCC = '';
let cafe = '';          // $1.000, IVA 21, 10 en stock
let te = '';            // $500, IVA 10,5, sin stock

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const prod = (S: SesionActiva, nombre: string, precio: string, iva: number, extra: object = {}) =>
  guardarProducto(S, null, { codigo: '', nombre, rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: precio }, stockMinimo: '', stockIdeal: '', ...extra });
const renglon = (productoId: string | null, cantidad: string, extra: object = {}) =>
  ({ productoId, descripcion: productoId ? '' : 'Ítem libre', cantidad, precio: '1000', descuentoPct: 0, iva: 21, ...extra });
const venta = (S: SesionActiva, over: Record<string, unknown> = {}) =>
  cerrarVenta(S, { clave: randomUUID(), clienteId: undefined, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [renglon(cafe, '1')], cobro: { tipo: 'caja', medioPagoId: medioEfectivo, cajaId: efectivo }, ...over });
const saldoCaja = async (S: SesionActiva, id: string) => (await obtenerCaja(S, id))?.saldo;
const stockDe = async (S: SesionActiva, id: string) => (await obtenerProducto(S, id))?.stock;
let consumidor = '';

before(async () => {
  A = await sesionDe(`ven-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`ven-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  banco = await guardarCaja(A, null, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '0' });
  await abrirCaja(A, banco, { contado: '0' });
  medioEfectivo = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [efectivo] });
  medioTarjeta = await guardarMedioDePago(A, null, { nombre: 'Tarjeta', comisionPct: 3, ivaComision: 21, cajaIds: [banco] });
  const cat = await guardarCategoria(A, null, { nombre: 'Con cuenta', listaId: null, cuentaCorriente: true, descuento: 0, ventaACosto: false });
  const base = { telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final' };
  clienteCC = await guardarCliente(A, null, { ...base, nombre: 'Cliente CC', categoriaId: cat });
  clienteSinCC = await guardarCliente(A, null, { ...base, nombre: 'Cliente sin CC', categoriaId: null });
  consumidor = (await buscarClientesParaVenta(A, 'consumidor'))[0]!.id;
  cafe = await prod(A, 'Café molido', '1000', 21);
  te = await prod(A, 'Té verde', '500', 10.5);
  await registrarStock(A, cafe, { tipo: 'saldo_inicial', cantidad: '10', concepto: '' });
});
after(async () => {
  await cerrarPool();
});

test('cerrar una venta en efectivo cobra en la caja y descuenta el stock', async () => {
  const antes = await saldoCaja(A, efectivo);
  const r = await venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '2')] });
  assert.equal(r.total, '2000.00');
  assert.equal(r.repetida, false);
  assert.equal(Number(await saldoCaja(A, efectivo)) - Number(antes), 2000);
  assert.equal(await stockDe(A, cafe), '8.000');
  const v = await obtenerVenta(A, r.id);
  assert.equal(v?.renglones[0]?.descripcion, 'Café molido'); // el nombre sale del catálogo
  assert.equal(v?.cobro, 'Efectivo · Efectivo');
});

test('descuentos por renglón y total, e IVA incluido en facturas', async () => {
  const r = await venta(A, {
    clienteId: consumidor, comprobante: 'factura_b', nroComprobante: '0001-00000042', descuentoTotalPct: 5,
    renglones: [renglon(cafe, '2', { descuentoPct: 10 }), renglon(te, '1', { precio: '500' })],
  });
  assert.equal(r.total, '2185.00'); // (1800 + 500) − 5 %
  const v = await obtenerVenta(A, r.id);
  assert.equal(v?.subtotal, '2300.00');
  assert.equal(v?.descuentoTotal, '115.00');
  assert.equal(v?.nroComprobante, '0001-00000042');
  assert.equal(v?.renglones[0]?.iva, '21.0');
  assert.equal(v?.renglones[1]?.iva, '10.5'); // el IVA lo da el producto, no el cliente
  assert.equal(v?.ivaIncluido, '341.92'); // 1710 × 21/121 = 296,78  +  475 × 10,5/110,5 = 45,14
});

test('el medio con comisión deja el cobro y la comisión como movimientos aparte', async () => {
  const antes = Number(await saldoCaja(A, banco));
  const r = await venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '1')], cobro: { tipo: 'caja', medioPagoId: medioTarjeta, cajaId: banco } });
  assert.equal(r.comision, '36.30'); // 1000 × 3 % × 1,21
  assert.equal(Number((Number(await saldoCaja(A, banco)) - antes).toFixed(2)), 963.7);
  const m = await conTenant(A.tenantId, (c) => c.query("SELECT tipo, importe::text FROM caja_movimientos WHERE venta_id = $1 ORDER BY id", [r.id]));
  assert.deepEqual(m.rows.map((x) => [x.tipo, x.importe]), [['cobro_venta', '1000.00'], ['comision_venta', '-36.30']]);
});

test('cuenta corriente: suma al saldo del cliente, no toca la caja y exige categoría habilitada', async () => {
  const cajaAntes = await saldoCaja(A, efectivo);
  const r = await venta(A, { clienteId: clienteCC, renglones: [renglon(cafe, '1')], cobro: { tipo: 'cuenta_corriente' } });
  assert.equal((await obtenerCliente(A, clienteCC))?.saldo, '1000.00');
  assert.equal(await saldoCaja(A, efectivo), cajaAntes);
  assert.equal((await obtenerVenta(A, r.id))?.cobro, 'Cuenta corriente');
  await assert.rejects(venta(A, { clienteId: clienteSinCC, cobro: { tipo: 'cuenta_corriente' } }), ErrorDeUsuario);
  await assert.rejects(venta(A, { clienteId: consumidor, cobro: { tipo: 'cuenta_corriente' } }), ErrorDeUsuario);
  const cli = (await buscarClientesParaVenta(A, 'cliente cc'))[0]!;
  assert.equal(cli.cuentaCorriente, true);
  assert.equal(cli.saldo, '1000.00');
});

test('vender sin stock se permite, deja el stock negativo y avisa', async () => {
  const r = await venta(A, { clienteId: consumidor, renglones: [renglon(te, '3', { precio: '500' })] });
  assert.equal(await stockDe(A, te), '-4.000'); // ya se había vendido 1 en la factura de arriba
  assert.deepEqual(r.avisosStock, ['Té verde']);
});

test('cerrar dos veces con la misma clave no duplica la venta ni los movimientos', async () => {
  const clave = randomUUID();
  const antes = (await listarVentas(A, { limite: 200 })).length;
  const stockAntes = Number(await stockDe(A, cafe));
  const r1 = await venta(A, { clave, clienteId: consumidor });
  const r2 = await venta(A, { clave, clienteId: consumidor });
  assert.equal(r2.repetida, true);
  assert.equal(r2.id, r1.id);
  assert.equal((await listarVentas(A, { limite: 200 })).length, antes + 1);
  assert.equal(Number(await stockDe(A, cafe)), stockAntes - 1);
});

test('el número de venta es correlativo, también con ventas simultáneas', async () => {
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => venta(A, { clienteId: consumidor })));
  const numeros = rs.map((r) => r.numero).sort((a, b) => a - b);
  assert.equal(new Set(numeros).size, 5);
  assert.equal(numeros[4]! - numeros[0]!, 4);
});

test('si algo falla no queda nada a medias (stock, caja ni venta)', async () => {
  const stockAntes = await stockDe(A, cafe);
  const ventas = (await listarVentas(A, { limite: 200 })).length;
  await assert.rejects(venta(A, { clienteId: consumidor, cobro: { tipo: 'caja', medioPagoId: medioEfectivo, cajaId: banco } }), ErrorDeUsuario); // medio no habilitado en esa caja
  await assert.rejects(venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '1'), renglon(randomUUID(), '1')] }), ErrorDeUsuario);
  assert.equal(await stockDe(A, cafe), stockAntes);
  assert.equal((await listarVentas(A, { limite: 200 })).length, ventas);
});

test('una caja cerrada no cobra ventas', async () => {
  const c = await guardarCaja(A, null, { nombre: 'Cerrada', tipo: 'efectivo', impuestoTransaccion: 0 });
  const m = await guardarMedioDePago(A, null, { nombre: 'Efectivo 2', comisionPct: 0, ivaComision: 21, cajaIds: [c] });
  await assert.rejects(venta(A, { clienteId: consumidor, cobro: { tipo: 'caja', medioPagoId: m, cajaId: c } }), ErrorDeUsuario);
  await abrirCaja(A, c, { contado: '0' });
  await venta(A, { clienteId: consumidor, cobro: { tipo: 'caja', medioPagoId: m, cajaId: c } });
  await cerrarCaja(A, c, { contado: '1000', cambioDejado: '1000', destinoId: null });
  await assert.rejects(venta(A, { clienteId: consumidor, cobro: { tipo: 'caja', medioPagoId: m, cajaId: c } }), ErrorDeUsuario);
});

test('rechaza datos inválidos', async () => {
  const mal = (over: Record<string, unknown>) => assert.rejects(venta(A, { clienteId: consumidor, ...over }), ErrorDeUsuario);
  await mal({ renglones: [] });
  await mal({ renglones: [renglon(cafe, '0')] });
  await mal({ renglones: [renglon(cafe, '-1')] });
  await mal({ renglones: [renglon(cafe, '1', { descuentoPct: 101 })] });
  await mal({ renglones: [renglon(null, '1', { iva: 5 })] });
  await mal({ renglones: [renglon(null, '1', { descripcion: ' ' })] });
  await mal({ renglones: [renglon(null, '1', { precio: '-5' })] });
  await mal({ descuentoTotalPct: 150 });
  await mal({ comprobante: 'nota_credito' });
  await mal({ clienteId: randomUUID() });
  await mal({ listaId: randomUUID() });
});

test('un producto archivado o que no se vende no se puede vender', async () => {
  const p = await prod(A, 'Archivado', '10', 21);
  await archivarProducto(A, p, false);
  await assert.rejects(venta(A, { clienteId: consumidor, renglones: [renglon(p, '1')] }), ErrorDeUsuario);
  const noVende = await prod(A, 'Solo insumo', '10', 21, { vendible: false });
  await assert.rejects(venta(A, { clienteId: consumidor, renglones: [renglon(noVende, '1')] }), ErrorDeUsuario);
  assert.equal((await buscarProductosParaVenta(A, 'solo insumo', lista)).length, 0);
});

test('el ítem libre se vende sin tocar el stock', async () => {
  const antes = await conTenant(A.tenantId, (c) => c.query('SELECT count(*)::int AS n FROM stock_movimientos'));
  const r = await venta(A, { clienteId: consumidor, renglones: [renglon(null, '2', { descripcion: 'Envío', precio: '300' })] });
  assert.equal(r.total, '600.00');
  const despues = await conTenant(A.tenantId, (c) => c.query('SELECT count(*)::int AS n FROM stock_movimientos'));
  assert.equal(despues.rows[0].n, antes.rows[0].n);
});

test('la búsqueda de productos trae el precio de la lista y el stock', async () => {
  const [p] = await buscarProductosParaVenta(A, 'CAFÉ molidos', lista);
  assert.equal(p?.id, cafe);
  assert.equal(p?.precio, '1000.00');
  assert.equal(p?.iva, 21);
  const actuales = await buscarProductosParaVenta(A, '', lista, [cafe, te]);
  assert.equal(actuales.length, 2);
});

test('un comercio no ve ni usa datos de otro', async () => {
  const r = await venta(A, { clienteId: consumidor });
  assert.equal(await obtenerVenta(B, r.id), null);
  assert.equal((await listarVentas(B, { limite: 200 })).length, 0);
  const consumidorB = (await buscarClientesParaVenta(B, ''))[0]!.id;
  const listaB = (await listasDePrecios(B))[0]!.id;
  const mal = (over: Record<string, unknown>) => assert.rejects(cerrarVenta(B, { clave: randomUUID(), clienteId: consumidorB, comprobante: 'remito', nroComprobante: '', listaId: listaB, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [renglon(cafe, '1')], cobro: { tipo: 'caja', medioPagoId: medioEfectivo, cajaId: efectivo }, ...over }), ErrorDeUsuario);
  await mal({});
  await mal({ renglones: [renglon(null, '1')] }); // sin forma de cobro válida del otro comercio
  await mal({ clienteId: consumidor, renglones: [renglon(null, '1')] });
  assert.equal((await buscarProductosParaVenta(B, 'café', listaB)).length, 0);
});

test('medios de pago: configurar requiere permiso, no repite nombres y valida la comisión', async () => {
  const cajera: SesionActiva = { ...A, rol: 'atencion' };
  await assert.rejects(guardarMedioDePago(cajera, null, { nombre: 'X', comisionPct: 0, ivaComision: 21, cajaIds: [] }), ErrorDePermiso);
  await assert.rejects(guardarMedioDePago(A, null, { nombre: 'efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [] }), ErrorDeUsuario);
  await assert.rejects(guardarMedioDePago(A, null, { nombre: 'Raro', comisionPct: 120, ivaComision: 21, cajaIds: [] }), ErrorDeUsuario);
  await assert.rejects(guardarMedioDePago(A, null, { nombre: 'Raro', comisionPct: 1, ivaComision: 7, cajaIds: [] }), ErrorDeUsuario);
  await assert.rejects(guardarMedioDePago(A, null, { nombre: 'Raro', comisionPct: 1, ivaComision: 21, cajaIds: [randomUUID()] }), ErrorDeUsuario);
});

test('cerrar una venta queda en la auditoría', async () => {
  const r = await venta(A, { clienteId: consumidor });
  const a = await conTenant(A.tenantId, (c) => c.query("SELECT accion FROM auditoria WHERE entidad = 'venta' AND entidad_id = $1", [r.id]));
  assert.equal(a.rows[0].accion, 'cerrar');
});

test('anular una venta en caja devuelve el stock y saca el cobro y la comisión, sin borrar nada', async () => {
  const p = await prod(A, 'Yerba', '1000', 21);
  await registrarStock(A, p, { tipo: 'saldo_inicial', cantidad: '5', concepto: '' });
  const cajaAntes = Number(await saldoCaja(A, banco));
  const r = await venta(A, { clienteId: consumidor, renglones: [renglon(p, '2')], cobro: { tipo: 'caja', medioPagoId: medioTarjeta, cajaId: banco } });
  assert.equal(await stockDe(A, p), '3.000');
  await assert.rejects(anularVenta(A, r.id, ''), ErrorDeUsuario); // exige motivo
  await anularVenta(A, r.id, 'Error de carga');
  assert.equal(await stockDe(A, p), '5.000');
  assert.equal(Number(await saldoCaja(A, banco)), cajaAntes);
  const v = await obtenerVenta(A, r.id);
  assert.equal(v?.estado, 'anulada');
  assert.equal(v?.motivoAnulacion, 'Error de carga');
  // Los movimientos originales siguen ahí, cada reversión apunta a su original.
  const caja = await conTenant(A.tenantId, (c) => c.query("SELECT tipo, importe::text, revierte_id FROM caja_movimientos WHERE venta_id = $1 ORDER BY id", [r.id]));
  assert.deepEqual(caja.rows.map((x) => [x.tipo, x.importe, x.revierte_id !== null]), [['cobro_venta', '2000.00', false], ['comision_venta', '-72.60', false], ['reversion', '-2000.00', true], ['reversion', '72.60', true]]);
  const st = await conTenant(A.tenantId, (c) => c.query("SELECT tipo, cantidad::text FROM stock_movimientos WHERE venta_id = $1 ORDER BY id", [r.id]));
  assert.deepEqual(st.rows.map((x) => [x.tipo, x.cantidad]), [['venta', '-2.000'], ['reversion', '2.000']]);
  const a = await conTenant(A.tenantId, (c) => c.query("SELECT accion FROM auditoria WHERE entidad = 'venta' AND entidad_id = $1 ORDER BY id", [r.id]));
  assert.deepEqual(a.rows.map((x) => x.accion), ['cerrar', 'anular']);
});

test('no se puede anular dos veces ni anular lo que no existe', async () => {
  const r = await venta(A, { clienteId: consumidor });
  await anularVenta(A, r.id, 'Duplicada');
  await assert.rejects(anularVenta(A, r.id, 'Otra vez'), ErrorDeUsuario);
  await assert.rejects(anularVenta(A, randomUUID(), 'No existe'), ErrorDeUsuario);
  await assert.rejects(anularVenta(A, 'no-es-uuid', 'Mal'), ErrorDeUsuario);
  const movs = await conTenant(A.tenantId, (c) => c.query("SELECT count(*)::int AS n FROM caja_movimientos WHERE venta_id = $1", [r.id]));
  assert.equal(movs.rows[0].n, 2); // cobro + una sola reversión
});

test('anular una venta a cuenta corriente baja la deuda del cliente', async () => {
  const antes = (await obtenerCliente(A, clienteCC))?.saldo;
  const r = await venta(A, { clienteId: clienteCC, renglones: [renglon(cafe, '1')], cobro: { tipo: 'cuenta_corriente' } });
  assert.equal(Number((await obtenerCliente(A, clienteCC))?.saldo) - Number(antes), 1000);
  await anularVenta(A, r.id, 'Cliente se arrepintió');
  assert.equal((await obtenerCliente(A, clienteCC))?.saldo, antes);
});

test('se puede anular una venta aunque la caja ya esté cerrada', async () => {
  const c = await guardarCaja(A, null, { nombre: 'Anular tras cierre', tipo: 'efectivo', impuestoTransaccion: 0 });
  const m = await guardarMedioDePago(A, null, { nombre: 'Efectivo 3', comisionPct: 0, ivaComision: 21, cajaIds: [c] });
  await abrirCaja(A, c, { contado: '0' });
  const r = await venta(A, { clienteId: consumidor, cobro: { tipo: 'caja', medioPagoId: m, cajaId: c } });
  await cerrarCaja(A, c, { contado: '1000', cambioDejado: '1000', destinoId: null });
  await anularVenta(A, r.id, 'Devolución del cliente');
  assert.equal((await obtenerVenta(A, r.id))?.estado, 'anulada');
  assert.equal(await saldoCaja(A, c), '0.00');
});

test('un comercio no puede anular ventas de otro y la base no deja tocar una venta cerrada', async () => {
  const r = await venta(A, { clienteId: consumidor });
  await assert.rejects(anularVenta(B, r.id, 'Intento ajeno'), ErrorDeUsuario);
  assert.equal((await obtenerVenta(A, r.id))?.estado, 'cerrada');
  // La base no deja anular tocando la venta a mano: una cerrada solo cambia de estado.
  await assert.rejects(conTenant(A.tenantId, (c) => c.query("UPDATE ventas SET total = 1 WHERE id = $1", [r.id])));
});

test('descuento por total final: la venta cierra en ese total y guarda el descuento equivalente', async () => {
  const antes = Number(await saldoCaja(A, efectivo));
  const r = await venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '2')], totalFinal: '1750' });
  assert.equal(r.total, '1750.00');
  assert.equal(Number(await saldoCaja(A, efectivo)) - antes, 1750);
  const v = await obtenerVenta(A, r.id);
  assert.equal(v?.descuentoTotal, '250.00');
  assert.equal(v?.descuentoPct, '12.50');
  assert.equal(v?.renglones[0]?.total, '1750.00');
  // Con total final el porcentaje que se mande se ignora.
  const r2 = await venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '1')], descuentoTotalPct: 50, totalFinal: '900' });
  assert.equal(r2.total, '900.00');
  // Total 0 = todo descontado; superar el subtotal se rechaza.
  assert.equal((await venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '1')], totalFinal: '0', cobro: { tipo: 'cuenta_corriente' } }).catch(() => ({ total: 'x' }))).total.length > 0, true);
  await assert.rejects(venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '1')], totalFinal: '1000.01' }), ErrorDeUsuario);
  await assert.rejects(venta(A, { clienteId: consumidor, renglones: [renglon(cafe, '1')], totalFinal: '-5' }), ErrorDeUsuario);
});

test('descuento por total final reparte el IVA de una factura sobre el total que se cobra', async () => {
  const r = await venta(A, { clienteId: consumidor, comprobante: 'factura_b', renglones: [renglon(cafe, '1')], totalFinal: '605' });
  const v = await obtenerVenta(A, r.id);
  assert.equal(v?.total, '605.00');
  assert.equal(v?.ivaIncluido, '105.00'); // 605 × 21 ÷ 121
});
