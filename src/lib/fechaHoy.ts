// Fecha de hoy como yyyy-mm-dd en hora local (toISOString usa UTC, y de noche
// en Argentina ya daría el día siguiente).
export function fechaHoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Muestra una fecha guardada como yyyy-mm-dd (columna "date", sin hora) tal cual
// se cargó. new Date('2026-10-06') la toma como medianoche UTC y en Argentina
// mostraría el día anterior; con la hora local explícita no se corre.
export function formatearFechaSola(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-AR');
}
