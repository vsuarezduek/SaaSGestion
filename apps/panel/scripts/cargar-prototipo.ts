// Carga en un comercio los datos exportados del prototipo con scripts/prototipo/exportar.mjs:
// datos extras, categorías de cliente, proveedores, clientes, productos y saldo inicial de cada caja.
// Al final compara los totales del sistema con los del prototipo (config.json → control).
//
// Uso (desde apps/panel):
//   node scripts/cargar-prototipo.ts --carpeta <salida de exportar.mjs> --comercio <slug> [--simular]
//   Para crear el comercio en el mismo paso: --crear --nombre "<nombre>" --email <admin> --admin "<nombre admin>"
//   y la contraseña del administrador en la variable CLAVE_ADMIN (nunca en la línea de comandos).
//
// Base: la misma regla que la app (lib/db.ts). Fuera de Vercel usa DATABASE_URL_LOCAL o DATABASE_URL_STAGING.
// Producción solo con --produccion y VERCEL_ENV=production, y solo con datos NO anonimizados; en cualquier otro entorno
// se exigen datos anonimizados (CLAUDE.md: staging nunca con datos reales de clientes).
// Se puede correr de nuevo: lo que ya existe se omite (no duplica personas, productos, stock ni saldos).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { comercioPorSlug, crearComercio, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, listarCajasParaAjustes, movimientoManual, movimientosDeCaja } from '../lib/cajas.ts';
import { listasDePrecios } from '../lib/catalogo.ts';
import { cerrarPool, conTenant, nombreVariable } from '../lib/db.ts';
import { crearDatoExtra, listarDatosExtra } from '../lib/extras.ts';
import { importarLista, type TipoImportacion } from '../lib/importar.ts';
import { guardarCategoria, listarCategorias } from '../lib/personas.ts';

interface Config {
  anonimizado: boolean;
  datosExtra: string[];
  categorias: { nombre: string; lista: string; descuento: number; ventaACosto: boolean; cuentaCorriente: boolean }[];
  cajas: { nombre: string; tipo: 'efectivo' | 'digital'; saldo: string }[];
  control: { proveedores: number; clientes: number; productos: number; saldoClientes: string; saldoProveedores: string; unidadesStock: string; valorStockCosto: string };
}

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n: string): boolean => args.includes(n);

async function main(): Promise<number> {
  const carpeta = opt('--carpeta'), slug = opt('--comercio');
  if (!carpeta || !slug) { console.error('Faltan --carpeta y --comercio'); return 1; }
  const cfg = JSON.parse(readFileSync(join(carpeta, 'config.json'), 'utf8')) as Config;
  const simular = flag('--simular');

  const variable = nombreVariable();
  if (variable === 'DATABASE_URL' && !flag('--produccion')) { console.error('Esto apunta a producción: hace falta --produccion (y el OK del dueño).'); return 1; }
  if (variable === 'DATABASE_URL' && cfg.anonimizado) { console.error('En producción se cargan los datos reales, no los anonimizados.'); return 1; }
  if (variable !== 'DATABASE_URL' && !cfg.anonimizado) { console.error('Fuera de producción solo se cargan datos anonimizados (exportar.mjs --anonimizar).'); return 1; }
  console.log(`Base: ${variable} · comercio: ${slug}${simular ? ' · SIMULACIÓN (no guarda nada)' : ''}`);

  // Comercio y sesión del administrador
  let tenantId = (await comercioPorSlug(slug))?.id;
  if (!tenantId) {
    if (!flag('--crear')) { console.error(`No existe el comercio «${slug}». Usá --crear para darlo de alta.`); return 1; }
    if (simular) { console.error('Con --simular no se crea el comercio.'); return 1; }
    const contrasena = process.env.CLAVE_ADMIN ?? '';
    tenantId = await crearComercio({ slug, nombre: opt('--nombre') ?? slug, email: opt('--email') ?? '', nombreAdmin: opt('--admin') ?? '', contrasena });
    console.log(`✓ Comercio creado: ${slug}`);
  }
  const adm = (await conTenant(tenantId, (c) => c.query<{ id: string; nombre: string; email: string }>(
    "SELECT id, nombre, email FROM usuarios WHERE rol = 'administrador' AND activo ORDER BY creado_en LIMIT 1"))).rows[0];
  if (!adm) { console.error('El comercio no tiene un administrador activo'); return 1; }
  const s: SesionActiva = { usuarioId: adm.id, tenantId, comercio: slug, nombre: adm.nombre, email: adm.email, rol: 'administrador', permisos: [] };

  if (!simular) {
    // Datos extras y categorías: tienen que existir antes de importar productos y clientes.
    const extras = new Set((await listarDatosExtra(s)).map((x) => x.nombre.toLowerCase()));
    for (const n of cfg.datosExtra) if (!extras.has(n.toLowerCase())) { await crearDatoExtra(s, n); console.log(`✓ Dato extra: ${n}`); }
    const listas = await listasDePrecios(s);
    const cats = new Set((await listarCategorias(s)).map((x) => x.nombre.toLowerCase()));
    for (const c of cfg.categorias) {
      if (cats.has(c.nombre.toLowerCase())) continue;
      const lista = listas.find((l) => l.nombre.toLowerCase() === c.lista.toLowerCase());
      await guardarCategoria(s, null, { nombre: c.nombre, listaId: lista?.id ?? null, cuentaCorriente: c.cuentaCorriente, descuento: c.descuento, ventaACosto: c.ventaACosto });
      console.log(`✓ Categoría: ${c.nombre}`);
    }
  }

  // Listas por CSV, en orden: los productos buscan su proveedor por nombre.
  let errores = 0;
  const pasos: [TipoImportacion, string][] = [['proveedores', '1-proveedores.csv'], ['clientes', '2-clientes.csv'], ['productos', '3-productos.csv']];
  for (const [tipo, archivo] of pasos) {
    const r = await importarLista(s, tipo, readFileSync(join(carpeta, archivo), 'utf8'), { actualizar: false, simular });
    errores += r.erroresTotales;
    console.log(`✓ ${tipo}: ${r.total} filas · ${r.creados} nuevos · ${r.omitidos} ya estaban · ${r.erroresTotales} con error`);
    for (const e of r.errores) console.log(`   fila ${e.fila}: ${e.mensaje}`);
  }

  // Cajas: se crean si faltan, se abren y reciben su saldo inicial (una sola vez).
  if (!simular) {
    for (const k of cfg.cajas) {
      let caja = (await listarCajasParaAjustes(s)).find((x) => x.nombre.toLowerCase() === k.nombre.toLowerCase());
      if (!caja) { await guardarCaja(s, null, { nombre: k.nombre, tipo: k.tipo, impuestoTransaccion: 0 }); caja = (await listarCajasParaAjustes(s)).find((x) => x.nombre.toLowerCase() === k.nombre.toLowerCase())!; }
      if (!caja.turnoId) await abrirCaja(s, caja.id, { contado: '0' });
      const yaCargada = (await movimientosDeCaja(s, caja.id, 50)).some((m) => m.concepto === 'Saldo inicial (prototipo)');
      if (!yaCargada && Number(k.saldo) !== 0) {
        const negativo = k.saldo.startsWith('-');
        await movimientoManual(s, caja.id, { tipo: negativo ? 'egreso' : 'ingreso', importe: k.saldo.replace('-', ''), concepto: 'Saldo inicial (prototipo)' });
      }
      console.log(`✓ Caja ${k.nombre}: saldo inicial ${k.saldo}${yaCargada ? ' (ya estaba)' : ''}`);
    }
  }

  // Control: lo que quedó en el sistema contra lo que había en el prototipo.
  if (simular) { console.log(errores ? `\n${errores} filas con error` : '\nSimulación sin errores'); return errores ? 2 : 0; }
  const t = (await conTenant(tenantId, (c) => c.query<Record<string, string>>(`
    SELECT (SELECT count(*) FROM proveedores WHERE activo)::text AS proveedores,
           (SELECT count(*) FROM clientes WHERE activo AND NOT es_consumidor_final)::text AS clientes,
           (SELECT count(*) FROM productos WHERE activo)::text AS productos,
           (SELECT COALESCE(sum(importe), 0) FROM cuenta_corriente_movimientos WHERE cliente_id IS NOT NULL)::numeric(14,2)::text AS "saldoClientes",
           (SELECT COALESCE(sum(importe), 0) FROM cuenta_corriente_movimientos WHERE proveedor_id IS NOT NULL)::numeric(14,2)::text AS "saldoProveedores",
           (SELECT COALESCE(sum(cantidad), 0) FROM stock_movimientos)::numeric(14,3)::text AS "unidadesStock",
           (SELECT COALESCE(sum(round(greatest(st.cantidad, 0) * p.costo, 2)), 0) FROM productos p
              JOIN (SELECT producto_id, sum(cantidad) AS cantidad FROM stock_movimientos GROUP BY producto_id) st ON st.producto_id = p.id)::numeric(14,2)::text AS "valorStockCosto"`))).rows[0]!;
  let difs = 0;
  console.log('\nControl                     Prototipo          Sistema');
  for (const [k, esperado] of Object.entries(cfg.control)) {
    const ok = Number(t[k]) === Number(esperado);
    if (!ok) difs++;
    console.log(`${ok ? '✓' : '✗'} ${k.padEnd(24)} ${String(esperado).padStart(16)} ${String(t[k]).padStart(16)}`);
  }
  console.log(difs || errores ? `\n${difs} totales distintos y ${errores} filas con error: revisar antes de seguir.` : '\nTodo coincide con el prototipo.');
  return difs || errores ? 2 : 0;
}

main().then(async (codigo) => { await cerrarPool(); process.exit(codigo); }, async (e) => { console.error(e); await cerrarPool(); process.exit(1); });
