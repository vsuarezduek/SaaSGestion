// Búsqueda por partes del texto, en cualquier orden, sin importar mayúsculas ni tildes,
// y con singular/plural equivalentes (regla del prototipo, ESPECIFICACION §1).

/** Minúsculas, sin tildes ni diéresis, espacios simples. */
export function plegar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita la terminación de plural: "almendras" → "almendra", "frutos" → "fruto", "panes" → "pan". */
export function singular(palabra: string): string {
  if (palabra.length > 4 && palabra.endsWith('es')) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith('s')) return palabra.slice(0, -1);
  return palabra;
}

/** Palabras a buscar: cada una debe estar contenida (en cualquier orden) en el texto del producto. */
export function terminosDeBusqueda(consulta: string): string[] {
  return plegar(consulta)
    .split(' ')
    .filter(Boolean)
    .slice(0, 8)
    .map(singular);
}

/** Escapa % _ \ para usarlo dentro de un LIKE. */
export function escaparLike(t: string): string {
  return t.replace(/[\\%_]/g, (c) => '\\' + c);
}
