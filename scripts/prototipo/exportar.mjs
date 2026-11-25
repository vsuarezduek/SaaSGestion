#!/usr/bin/env node
// Convierte los datos del prototipo (HTML + volcado de su base) en los CSV que entiende «Ajustes → Importar».
// No toca ninguna base: solo lee archivos y escribe CSV y un resumen para comparar después de importar.
//
// Uso:
//   node scripts/prototipo/exportar.mjs --html <prototipo.html> --base <carpeta del volcado> --salida <carpeta> [--anonimizar]
//
// La carpeta del volcado tiene una subcarpeta por colección del prototipo (pm, cm, vm, cc, cajas, movs, ccat, rub, cfg)
// con un JSON por documento (<id>.json), como la deja la herramienta de datos de artifacts.
// --anonimizar reemplaza los datos personales de los clientes (nombre, teléfono, mail, domicilio, CUIT) para ensayar en
// staging sin datos reales de clientes; los saldos, productos y proveedores quedan iguales.
// --saldo-caja "Nombre=importe" (se puede repetir) fija el saldo inicial de una caja en vez del que da el prototipo,
// cuando el dueño decide arrancar esa caja con otro saldo (por ejemplo "Mercadopago=0"). Queda anotado en el resumen.
//
// Redondeo: el prototipo guarda importes como número de JavaScript. Cada saldo se calcula como el prototipo (suma de los
// movimientos) y recién al final se redondea a centavos, mitad hacia arriba en valor absoluto. Así el CSV muestra lo
// mismo que la pantalla del prototipo.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ───────── Argumentos ─────────
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const HTML = opt('--html'), BASE = opt('--base'), SALIDA = opt('--salida');
const ANON = args.includes('--anonimizar');
// --unir-proveedores-repetidos: dos proveedores con el mismo nombre se importan como uno solo (el primero); el segundo
// le suma su saldo y completa los datos que al primero le faltan. Sin la opción, el segundo entra como «Nombre (2)».
const UNIR_PROV = args.includes('--unir-proveedores-repetidos');
// --omitir-cliente "Nombre" (se puede repetir): ese cliente no se importa. Si tenía saldo se avisa, porque los totales cambian.
const plano0 = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const OMITIR_CLI = new Set(args.flatMap((a, i) => (a === '--omitir-cliente' ? [plano0(args[i + 1])] : [])));
/** Saldos de caja fijados a mano: nombre en minúsculas → centavos. */
const SALDO_CAJA = new Map(args.flatMap((a, i) => (a === '--saldo-caja' ? [args[i + 1] ?? ''] : [])).map((v) => {
  const m = /^(.+)=(-?\d+(?:[.,]\d{1,2})?)$/.exec(v.trim());
  if (!m) { console.error(`--saldo-caja "${v}": usá "Nombre=importe", por ejemplo "Mercadopago=0"`); process.exit(1); }
  return [m[1].trim().toLowerCase(), Math.round(Number(m[2].replace(',', '.')) * 100)];
}));
if (!HTML || !BASE || !SALIDA) {
  console.error('Uso: node scripts/prototipo/exportar.mjs --html <prototipo.html> --base <volcado> --salida <carpeta> [--anonimizar]');
  process.exit(1);
}

// ───────── Lectura ─────────
/** Toma el objeto literal `const NOMBRE={...}` del HTML sin ejecutar nada: se lee como JSON. */
export function objetoDelHtml(html, nombre) {
  const ini = html.indexOf(`const ${nombre}=`);
  if (ini < 0) throw new Error(`No encuentro ${nombre} en el HTML del prototipo`);
  let i = html.indexOf('{', ini), prof = 0, enTexto = false;
  const desde = i;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (enTexto) { if (ch === '\\') i++; else if (ch === '"') enTexto = false; continue; }
    if (ch === '"') enTexto = true;
    else if (ch === '{') prof++;
    else if (ch === '}' && --prof === 0) break;
  }
  return JSON.parse(html.slice(desde, i + 1));
}

function coleccion(nombre) {
  const dir = join(BASE, nombre);
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return out;
}

// ───────── Utilidades ─────────
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plano = (s) => fold(s).replace(/[^a-z0-9]/g, '');
/** Importe del prototipo → centavos enteros (mitad hacia arriba en valor absoluto). */
export const centavos = (x) => { const n = Number(x) || 0; return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7); };
/** Centavos → "1234,56" (sin separador de miles: lo lee igual Excel y el importador). */
export const importe = (c) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, '0')}`;
/** Cantidad con hasta 3 decimales, coma decimal. */
export const cantidad = (x) => { const n = Math.round((Number(x) || 0) * 1000) / 1000; return String(n).replace('.', ','); };
const celda = (x) => { const s = String(x ?? '').replace(/\r?\n/g, ' ').trim(); return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (filas) => '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';

/** Condición frente al IVA del prototipo → texto que acepta el importador. "Responsable Monotributo" es monotributo. */
export function condicionIva(txt) {
  const p = plano(txt);
  if (!p) return '';
  if (p.includes('monotribut')) return 'Monotributo';
  if (p.includes('inscript')) return 'Responsable Inscripto';
  if (p.includes('exent')) return 'Exento';
  if (p.startsWith('consumidor')) return 'Consumidor Final';
  return null; // desconocida: se avisa en el resumen
}
/** Clave de respaldo para nombres con caracteres rotos («PampaÃƒÂ´s» ↔ «Pampa´s»): solo letras y números ASCII. */
const asciiPlano = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const sinDato = (s) => !plano(s) || plano(s) === 'sinespecificar';
/** Nombre único: si ya se usó, le agrega « (2)», « (3)»… para que la importación no junte dos personas distintas. */
function nombreUnico(usados, nombre) {
  let n = String(nombre ?? '').trim(), i = 2;
  while (usados.has(plano(n))) n = `${String(nombre).trim()} (${i++})`;
  usados.set(plano(n), n);
  return n;
}
const cuitLimpio = (x) => { const s = String(x ?? '').replace(/\D/g, ''); return s && Number(s) !== 0 ? s : ''; };
/**
 * Deja los datos de contacto como los acepta el sistema (mismas reglas que lib/validacion.ts): CUIT de 11 números y no
 * repetido (si se repite, la importación juntaría dos personas), mail con arroba, largos máximos. Lo que no cumple
 * queda vacío y se cuenta en los avisos, para que la fila (y su saldo) no se pierda.
 */
function contactoValido(x, cuits, quien, cuenta) {
  let cuit = cuitLimpio(x.cuit);
  if (cuit && cuit.length !== 11) { cuenta.cuitCorto++; cuit = ''; }
  if (cuit && cuits.has(cuit)) { avisar(`${quien}: el CUIT ${cuit} ya lo tiene «${cuits.get(cuit)}», se importa sin CUIT`); cuit = ''; }
  if (cuit) cuits.set(cuit, x.n);
  let mail = String(x.mail ?? '').trim();
  if (mail && !/^[^@\s]+@[^@\s]+$/.test(mail)) { cuenta.mailMalo++; mail = ''; }
  const corto = (v, n) => { const t = String(v ?? '').trim(); if (t.length > n) cuenta.largo++; return t.slice(0, n); };
  return { cuit, mail, tel: corto(x.tel, 40), dom: corto(x.dom, 200), loc: corto(x.loc, 100) };
}

// ───────── Reconstrucción (igual que el prototipo) ─────────
const html = readFileSync(HTML, 'utf8');
const DATA = objetoDelHtml(html, 'DATA');
const XTRA = objetoDelHtml(html, 'XTRA');
const D = Object.fromEntries(['pm', 'cm', 'vm', 'cc', 'cajas', 'movs', 'ccat', 'rub', 'cfg'].map((n) => [n, coleccion(n)]));

const mk = (r) => ({ id: '' + r[0], n: r[1], cat: r[2], tel: r[3], mail: r[4], dom: r[5], loc: r[6], cuit: r[7], iva: r[8] });
const BC = DATA.C.map(mk), BV = DATA.V.map((r) => ({ ...mk(r), con: r[9] || '' }));
const BP = DATA.P.map((r) => ({
  ...((x) => (x ? { gm: XTRA.d[0][x[0]] || '', lm: XTRA.d[1][x[1]] || '', fr: XTRA.d[2][x[2]] || '', fe: XTRA.d[3][x[3]] || '' } : {}))(XTRA.x['' + r[0]]),
  id: '' + r[0], n: r[1], c: r[2], r: r[3], s: r[4], k: r[5], a: r[6], b: r[7], pv: r[8], iva: r[9], si: r[10], sm: r[11],
  fv: !!r[12], fc: !!r[13], fi: !!r[14], fx: !!r[15], fw: !!r[16] || XTRA.d[4][(XTRA.x['' + r[0]] || [])[4]] == 'TIENDANUBE', u: r[17],
}));
const unir = (base, over, defecto = {}) => {
  const ids = new Set(base.map((x) => x.id));
  return base.map((x) => ({ ...x, ...(over[x.id] || {}) }))
    .concat(Object.entries(over).filter(([i]) => !ids.has(i)).map(([id, v]) => ({ id, ...defecto, ...v })))
    .filter((x) => !x.del);
};
const clientes = unir(BC, D.cm), proveedores = unir(BV, D.vm);
const productos = unir(BP, D.pm, { s: 0, k: 0, a: 0, b: 0, si: 0, sm: 0, iva: 21, fv: true, fc: true });
const movsCc = Object.values(D.cc);
const saldo = (ent, id) => movsCc.filter((x) => x.ent == ent && x.eid == id).reduce((a, x) => a + x.m, 0);
const XF = Array.isArray(D.cfg.extras?.l) ? D.cfg.extras.l.map((x) => [x.k, x.n]) : [['lm', 'Lista mayorista'], ['gm', 'Grupo de compra mayorista'], ['fr', 'Categoría de fracción'], ['fe', 'Ferias']];

// Categorías de cliente (como cats() del prototipo)
const cats = {};
BC.forEach((c) => { if (c.cat && !cats[plano(c.cat)]) cats[plano(c.cat)] = { n: c.cat, lista: /mayor/i.test(c.cat) ? 'b' : 'a', desc: 0, costo: false, cc: !/consumidor/i.test(c.cat) }; });
Object.values(D.ccat).forEach((v) => { if (v.n) cats[plano(v.n)] = { ...(cats[plano(v.n)] || {}), ...v }; });
const categorias = Object.values(cats).filter((c) => !c.del).sort((a, b) => a.n.localeCompare(b.n, 'es'));

// ───────── Armado de los CSV ─────────
const avisos = [];
const avisar = (m) => avisos.push(m);
const esCF = (c) => plano(c.n) === 'consumidorfinal';

// Proveedores
const cuitsProv = new Map(), cuentaProv = { cuitCorto: 0, mailMalo: 0, largo: 0 };
const filasProv = [['Nombre', 'Contacto', 'Categoría', 'Teléfono', 'Email', 'Domicilio', 'Localidad', 'CUIT', 'Condición IVA', 'Saldo']];
let saldoProv = 0;
const nombresProv = new Map(), provAscii = new Map(), provPorNombre = new Map();
const filaProvPorNombre = new Map(), saldoFilaProv = new Map();
for (const p of proveedores) {
  const iva0 = condicionIva(p.iva);
  if (UNIR_PROV && filaProvPorNombre.has(plano(p.n))) {
    const fila = filaProvPorNombre.get(plano(p.n));
    const sd = centavos(saldo('p', p.id));
    const k = contactoValido(p, cuitsProv, `Proveedor «${p.n}» (repetido)`, cuentaProv);
    [p.con, p.cat, k.tel, k.mail, k.dom, k.loc, k.cuit, iva0 ?? ''].forEach((v, i) => { if (!fila[i + 1] && v) fila[i + 1] = v; });
    const total = saldoFilaProv.get(fila) + sd;
    saldoFilaProv.set(fila, total);
    fila[9] = total ? importe(total) : '';
    saldoProv += sd;
    avisar(`Proveedor repetido «${p.n}»: se importa uno solo${sd ? `; el saldo del repetido (${importe(sd)}) se suma al que queda` : ''}`);
    continue;
  }
  const nombre = nombreUnico(nombresProv, p.n);
  if (nombre !== String(p.n).trim()) avisar(`Proveedor repetido por nombre: «${p.n}» se importa como «${nombre}»`);
  if (!provPorNombre.has(plano(p.n))) provPorNombre.set(plano(p.n), nombre);
  if (!provAscii.has(asciiPlano(p.n))) provAscii.set(asciiPlano(p.n), nombre);
  const iva = condicionIva(p.iva);
  if (iva === null) avisar(`Proveedor «${p.n}»: condición IVA desconocida «${p.iva}», queda vacía`);
  const sd = centavos(saldo('p', p.id));
  saldoProv += sd;
  const k = contactoValido(p, cuitsProv, `Proveedor «${nombre}»`, cuentaProv);
  const fila = [nombre, p.con, p.cat, k.tel, k.mail, k.dom, k.loc, k.cuit, iva ?? '', sd ? importe(sd) : ''];
  filasProv.push(fila);
  filaProvPorNombre.set(plano(p.n), fila);
  saldoFilaProv.set(fila, sd);
}

// Clientes
const cuitsCli = new Map(), cuentaCli = { cuitCorto: 0, mailMalo: 0, largo: 0 };
const filasCli = [['Nombre', 'Categoría', 'Teléfono', 'Email', 'Domicilio', 'Localidad', 'CUIT', 'Condición IVA', 'Saldo']];
let saldoCli = 0, nCli = 0;
const nombresCli = new Map();
const omitidos = new Set();
for (const c of clientes) {
  const sd = centavos(saldo('c', c.id));
  if (OMITIR_CLI.has(plano(c.n))) {
    omitidos.add(plano(c.n));
    avisar(`Cliente ${ANON ? 'omitido' : '«' + c.n + '»'}: no se importa (pedido del dueño)${sd ? `. OJO: tenía saldo ${importe(sd)}, que no pasa al sistema` : ''}`);
    continue;
  }
  if (esCF(c)) { if (sd) avisar(`«Consumidor Final» tiene saldo ${importe(sd)} en el prototipo: no se importa (el sistema tiene su propio consumidor final)`); continue; }
  nCli++;
  const nombre = nombreUnico(nombresCli, c.n);
  if (nombre !== String(c.n).trim()) avisar(`Cliente repetido por nombre: ${ANON ? 'n.º ' + nCli : '«' + c.n + '»'} se importa como ${ANON ? 'otro' : '«' + nombre + '»'}`);
  const iva = condicionIva(c.iva);
  if (iva === null) avisar(`Cliente ${ANON ? nCli : '«' + c.n + '»'}: condición IVA desconocida «${c.iva}», queda Consumidor Final`);
  const cat = c.cat && cats[plano(c.cat)] && !cats[plano(c.cat)].del ? cats[plano(c.cat)].n : '';
  if (c.cat && !cat) avisar(`Cliente ${ANON ? nCli : '«' + c.n + '»'}: la categoría «${c.cat}» fue quitada en el prototipo, queda sin categoría`);
  saldoCli += sd;
  const k = contactoValido(c, cuitsCli, ANON ? `Cliente n.º ${nCli}` : `Cliente «${nombre}»`, cuentaCli);
  // Anonimizado: se conserva la forma de los datos (si había CUIT, mail o teléfono) con valores inventados.
  filasCli.push(ANON
    ? [`Cliente ${String(nCli).padStart(4, '0')}`, cat, k.tel ? '2610000000' : '', k.mail ? `cliente${nCli}@ejemplo.test` : '', '', k.loc, k.cuit ? `20${String(nCli).padStart(8, '0')}0` : '', iva ?? '', sd ? importe(sd) : '']
    : [nombre, cat, k.tel, k.mail, k.dom, k.loc, k.cuit, iva ?? '', sd ? importe(sd) : '']);
}

for (const [quien, c] of [['proveedores', cuentaProv], ['clientes', cuentaCli]]) {
  if (c.cuitCorto) avisar(`${c.cuitCorto} ${quien} tienen un CUIT/DNI que no es de 11 números: se importan sin CUIT (el sistema solo guarda CUIT)`);
  if (c.mailMalo) avisar(`${c.mailMalo} ${quien} tienen un mail mal escrito: se importan sin mail`);
  if (c.largo) avisar(`${c.largo} datos de ${quien} eran más largos de lo permitido y se recortaron`);
}

for (const n of OMITIR_CLI) if (!omitidos.has(n)) { console.error(`--omitir-cliente: no hay ningún cliente «${n}» en el prototipo`); process.exit(1); }

// Productos
const encProd = ['Código', 'Nombre', 'Rubro', 'Tipo', 'Proveedor', 'Unidad', 'Costo', 'IVA', 'Stock', 'Stock mínimo', 'Stock ideal', 'Minorista', 'Mayorista',
  'Se vende', 'Se compra', 'Integra otros', 'Publicado web', ...XF.map(([, l]) => l)];
const filasProd = [encProd];
let unidades = 0, valorCosto = 0, conReceta = 0, stockNegativo = 0;
/** id del prototipo → cómo se encuentra el producto en el sistema (código, o nombre si no tiene). */
const claveProd = new Map();
const codigos = new Map();
const si = (b) => (b ? 'Sí' : 'No');
for (const p of productos) {
  let cod = String(p.c ?? '').trim();
  if (cod && codigos.has(cod.toLowerCase())) { avisar(`Código repetido «${cod}»: «${codigos.get(cod.toLowerCase())}» y «${p.n}». Al segundo se le saca el código para que no pise al primero`); cod = ''; }
  if (cod) codigos.set(cod.toLowerCase(), p.n);
  claveProd.set(p.id, { codigo: cod, nombre: p.n });
  let prov = '';
  if (!sinDato(p.pv)) {
    prov = provPorNombre.get(plano(p.pv)) ?? provAscii.get(asciiPlano(p.pv)) ?? '';
    if (!prov) avisar(`Producto «${p.n}»: el proveedor «${p.pv}» no está en la lista de proveedores, queda sin proveedor`);
  }
  const iva = Number(p.iva ?? 21);
  if (![0, 10.5, 21, 27].includes(iva)) avisar(`Producto «${p.n}»: IVA ${p.iva} no válido, queda 21`);
  const stock = Math.round((Number(p.s) || 0) * 1000) / 1000;
  if (stock < 0) stockNegativo++;
  if (Array.isArray(p.ing) && p.ing.length) conReceta++;
  unidades += stock;
  valorCosto += centavos(Math.max(0, stock) * (Number(p.k) || 0));
  filasProd.push([cod, p.n, p.r, p.tp || 'Mercadería', prov, sinDato(p.u) ? 'unidad' : String(p.u).trim().toLowerCase(), importe(centavos(p.k)), [0, 10.5, 21, 27].includes(iva) ? String(iva).replace('.', ',') : '21',
    cantidad(stock), cantidad(p.sm), cantidad(p.si), p.a ? importe(centavos(p.a)) : '', p.b ? importe(centavos(p.b)) : '',
    si(p.fv !== false), si(p.fc !== false), si(!!p.fi), si(!!p.fw), ...XF.map(([k]) => p[k] || '')]);
}

// Recetas: cada producto con ingredientes (cantidad para una tanda), cuánto rinde la tanda e instrucciones.
// Los ingredientes se nombran por código o nombre, porque en el sistema los productos tienen otros identificadores.
const recetas = [];
let lineasReceta = 0;
for (const p of productos) {
  if (!Array.isArray(p.ing) || !p.ing.length) continue;
  const ingredientes = [];
  for (const i of p.ing) {
    const k = claveProd.get(String(i.id));
    const q = Math.round((Number(i.q) || 0) * 1000) / 1000;
    if (!k) { avisar(`Receta de «${p.n}»: el ingrediente ${i.id} ya no existe en el prototipo, se omite`); continue; }
    if (q <= 0) { avisar(`Receta de «${p.n}»: «${k.nombre}» tiene cantidad ${i.q} (menos de 0,001), se omite`); continue; }
    const previo = ingredientes.find((x) => x.codigo === k.codigo && x.nombre === k.nombre);
    if (previo) previo.cantidad = Math.round((previo.cantidad + q) * 1000) / 1000; else ingredientes.push({ ...k, cantidad: q });
  }
  if (!ingredientes.length) continue;
  lineasReceta += ingredientes.length;
  const rinde = Number(p.rinde) > 0 ? Math.round(Number(p.rinde) * 1000) / 1000 : 1;
  recetas.push({ ...claveProd.get(p.id), rinde, instrucciones: String(p.instr ?? '').trim(), ingredientes });
}

// Cajas: saldo = suma de movimientos (como bal() del prototipo)
const movs = Object.values(D.movs);
const cajas = Object.entries(D.cajas).filter(([, c]) => !c.del).sort((a, b) => (a[1].o ?? 0) - (b[1].o ?? 0))
  .map(([id, c]) => {
    const prototipo = centavos(movs.filter((m) => m.caja == id).reduce((a, m) => a + m.m, 0));
    const fijado = SALDO_CAJA.get(String(c.n).trim().toLowerCase());
    return { n: c.n, saldo: fijado ?? prototipo, prototipo, fijado: fijado !== undefined, cerrada: !!c.blq, tipo: c.tipo || 'efectivo' };
  });
for (const n of SALDO_CAJA.keys()) if (!cajas.some((c) => String(c.n).trim().toLowerCase() === n)) { console.error(`--saldo-caja: no hay ninguna caja «${n}» en el prototipo`); process.exit(1); }

// ───────── Salida ─────────
mkdirSync(SALIDA, { recursive: true });
writeFileSync(join(SALIDA, '1-proveedores.csv'), csv(filasProv));
writeFileSync(join(SALIDA, '2-clientes.csv'), csv(filasCli));
writeFileSync(join(SALIDA, '3-productos.csv'), csv(filasProd));

const $ = (c) => '$ ' + importe(c).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const resumen = `# Datos del prototipo para importar${ANON ? ' (clientes anonimizados, solo para staging)' : ''}

Generado el ${new Date().toISOString()} (UTC) con \`scripts/prototipo/exportar.mjs\`.

## Orden de carga
1. **Ajustes → Datos extras**: crear ${XF.map(([, l]) => `«${l}»`).join(', ')} (el importador completa solo los datos que ya existen).
2. **Clientes → Categorías**: crear las categorías de abajo.
3. **Ajustes → Importar → Proveedores**: \`1-proveedores.csv\`.
4. **Ajustes → Importar → Clientes**: \`2-clientes.csv\`.
5. **Ajustes → Importar → Productos**: \`3-productos.csv\`.
6. **Recetas**: \`4-recetas.json\` (${recetas.length} recetas; las carga \`cargar-prototipo.ts\`).
7. **Cajas**: cargar el saldo inicial de cada caja (tabla de abajo).
8. Comparar los totales de control con lo que muestra el sistema.

## Totales de control (tienen que coincidir después de importar)
| Qué | Prototipo |
|---|---|
| Proveedores | ${filasProv.length - 1} |
| Clientes (sin Consumidor Final) | ${filasCli.length - 1} |
| Productos | ${filasProd.length - 1} |
| Suma de saldos de clientes (positivo = nos deben) | ${$(saldoCli)} |
| Suma de saldos de proveedores (positivo = les debemos) | ${$(saldoProv)} |
| Unidades en stock (suma) | ${cantidad(unidades)} |
| Stock valorizado a costo (sin negativos) | ${$(valorCosto)} |
| Productos con stock negativo | ${stockNegativo} |
| Recetas (productos con ingredientes) | ${recetas.length} |
| Ingredientes en recetas (renglones) | ${lineasReceta} |

## Categorías de cliente
| Categoría | Lista | Descuento | Precio de costo | Cuenta corriente |
|---|---|---|---|---|
${categorias.map((c) => `| ${c.n} | ${c.lista === 'b' ? 'Mayorista' : 'Minorista'} | ${c.desc || 0}% | ${c.costo ? 'Sí' : 'No'} | ${c.cc === false ? 'No' : 'Sí'} |`).join('\n')}

## Cajas (saldo inicial que se carga)
| Caja | Tipo | Saldo inicial | Estado en el prototipo |
|---|---|---|---|
${cajas.map((c) => `| ${c.n} | ${c.tipo} | ${$(c.saldo)}${c.fijado ? ` (fijado a mano; en el prototipo ${$(c.prototipo)})` : ''} | ${c.cerrada ? 'cerrada' : 'abierta'} |`).join('\n')}

## Lo que no viaja en los CSV
- **Historial**: ventas, compras, movimientos de caja y de cuenta corriente anteriores quedan en el prototipo. El sistema arranca con saldos iniciales.
- Usuarios y permisos, configuración de medios de pago, impuestos y comisiones: se cargan en Ajustes.

## Avisos (${avisos.length})
${avisos.length ? avisos.map((a) => `- ${a}`).join('\n') : '- Ninguno.'}
`;
writeFileSync(join(SALIDA, 'resumen.md'), resumen);
writeFileSync(join(SALIDA, '4-recetas.json'), JSON.stringify(recetas, null, 2));
// Lo que el cargador necesita además de los CSV, y los totales para controlar después de importar.
writeFileSync(join(SALIDA, 'config.json'), JSON.stringify({
  anonimizado: ANON,
  datosExtra: XF.map(([, l]) => l),
  categorias: categorias.map((c) => ({ nombre: c.n, lista: c.lista === 'b' ? 'Mayorista' : 'Minorista', descuento: Number(c.desc) || 0, ventaACosto: !!c.costo, cuentaCorriente: c.cc !== false })),
  cajas: cajas.map((c) => ({ nombre: c.n, tipo: c.tipo === 'digital' ? 'digital' : 'efectivo', saldo: importe(c.saldo).replace(',', '.') })),
  control: {
    proveedores: filasProv.length - 1, clientes: filasCli.length - 1, productos: filasProd.length - 1,
    saldoClientes: importe(saldoCli).replace(',', '.'), saldoProveedores: importe(saldoProv).replace(',', '.'),
    recetas: recetas.length, lineasReceta,
    unidadesStock: (Math.round(unidades * 1000) / 1000).toFixed(3), valorStockCosto: importe(valorCosto).replace(',', '.'),
  },
}, null, 2));
console.log(resumen);
