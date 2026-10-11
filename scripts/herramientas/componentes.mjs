// Qué componentes hay que instalar y cuáles ya están instalados. Lo usan el instalador (`pnpm cliente`) y, con la misma lógica
// escrita en TypeScript, el panel (panel/src/server/componentes.ts); una prueba del panel vigila que las dos coincidan.
//
// Reglas (docs/COMPONENTES.md): la Base siempre está; Abastecimiento necesita la Base; Mantenimiento necesita la Base y Abastecimiento.
// "Lo que no se contrata no se instala": los componentes salen de los módulos que contrata el cliente.

export const ORDEN_COMPONENTES = ['base', 'abastecimiento', 'mantenimiento'];
export const NECESITA = { base: [], abastecimiento: ['base'], mantenimiento: ['base', 'abastecimiento'] };

const ordenar = (set) => ORDEN_COMPONENTES.filter((c) => set.has(c));

/** Componentes a instalar para una lista de módulos (ids). `modulos` es el contenido de src/lib/modulos.json. */
export function componentesParaModulos(ids, modulos) {
  const porId = new Map(modulos.map((m) => [m.id, m]));
  const vistos = new Set();
  const visitar = (id) => {
    if (vistos.has(id)) return;
    const m = porId.get(id);
    if (!m) throw new Error(`Módulo desconocido: ${id}`);
    vistos.add(id);
    for (const r of m.requiere) visitar(r);
  };
  ids.forEach(visitar);
  const comps = new Set(['base']);
  for (const id of vistos) for (const c of [porId.get(id).componente, ...NECESITA[porId.get(id).componente]]) comps.add(c);
  return ordenar(comps);
}

/** Componentes que faltan instalar para poder instalar `componente` (vacío si ya se puede). */
export function faltantesPara(componente, instalados) {
  return NECESITA[componente].filter((c) => !instalados.includes(c));
}

/**
 * Lo registrado en la base del cliente ("comp/archivo.sql") junto con el registro de antes de existir los componentes ("archivo.sql",
 * que significa: esa migración se aplicó entera, o sea con los tres componentes). `disponibles` son los nombres "comp/archivo.sql" de la plantilla.
 */
export function expandirRegistro(registrados, disponibles) {
  const hechas = new Set(registrados.filter((n) => n.includes('/')));
  for (const n of registrados.filter((x) => !x.includes('/'))) {
    for (const d of disponibles) if (d.endsWith('/' + n)) hechas.add(d);
  }
  return hechas;
}

/** Componentes instalados según el registro. Un registro "viejo" (sin carpeta) viene de una instalación completa. */
export function componentesInstalados(registrados) {
  const comps = new Set();
  for (const n of registrados) {
    if (!n.includes('/')) ORDEN_COMPONENTES.forEach((c) => comps.add(c));
    else { const c = n.split('/')[0]; if (ORDEN_COMPONENTES.includes(c)) comps.add(c); }
  }
  if (comps.size) comps.add('base');
  return ordenar(comps);
}
