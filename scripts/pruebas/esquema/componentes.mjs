// Componentes del producto y a cuál pertenece cada tabla. Ver docs/COMPONENTES.md y docs/PLAN-PRODUCTO.md.
//
// Regla de dependencias (siempre en una sola dirección):
//   Base           → solo puede apuntar a la Base
//   Abastecimiento → Base y Abastecimiento
//   Mantenimiento  → Base, Abastecimiento y Mantenimiento
// Una tabla nueva tiene que anotarse acá: si no, la prueba de esquema falla (así ninguna queda "sin dueño").

export const COMPONENTE = {
  // Base: usuarios, permisos, configuración, historial y Tareas
  usuarios_perfil: 'base', configuracion: 'base', licencia: 'base', audit_log: 'base', error_logs: 'base', sugerencias: 'base',
  tasks: 'base', task_history: 'base', migraciones_aplicadas: 'base', preferencias_modulos: 'base',
  // Abastecimiento: proveedores, comisionistas, envíos, depósitos (repuestos, stock, retiros, ajustes) y sus destinos (sectores)
  proveedores: 'abastecimiento', contactos: 'abastecimiento', comisionistas: 'abastecimiento',
  rotulos_generados: 'abastecimiento', rotulos_bultos: 'abastecimiento', rotulos_fotos: 'abastecimiento', rotulo_disenos: 'abastecimiento',
  items: 'abastecimiento', familias: 'abastecimiento', subfamilias: 'abastecimiento', planilla_familias: 'abastecimiento', item_proveedores: 'abastecimiento',
  retiros: 'abastecimiento', retiro_items: 'abastecimiento', ajustes_inventario: 'abastecimiento', ajuste_items: 'abastecimiento', sectores: 'abastecimiento',
  // Mantenimiento: equipos y reparaciones
  equipos: 'mantenimiento', equipo_items: 'mantenimiento', reparaciones: 'mantenimiento', reparacion_items: 'mantenimiento', reparacion_entregas: 'mantenimiento',
};

const PUEDE_APUNTAR = {
  base: ['base'],
  abastecimiento: ['base', 'abastecimiento'],
  mantenimiento: ['base', 'abastecimiento', 'mantenimiento'],
};

export const puedeApuntar = (desde, hacia) => PUEDE_APUNTAR[desde]?.includes(hacia) ?? false;
