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
  tasks: 'base', task_history: 'base', migraciones_aplicadas: 'base', preferencias_modulos: 'base', avisos_vistos: 'base',
  // Abastecimiento: proveedores, comisionistas, envíos, depósitos (repuestos, stock, retiros, ajustes), sus destinos (sectores) y las reparaciones
  // (lo que se manda a reparar afuera: un proveedor, repuestos del depósito y un envío; no dependen de los equipos)
  proveedores: 'abastecimiento', contactos: 'abastecimiento', comisionistas: 'abastecimiento',
  rotulos_generados: 'abastecimiento', rotulos_bultos: 'abastecimiento', rotulos_fotos: 'abastecimiento', rotulo_disenos: 'abastecimiento',
  items: 'abastecimiento', familias: 'abastecimiento', subfamilias: 'abastecimiento', planilla_familias: 'abastecimiento', item_proveedores: 'abastecimiento',
  retiros: 'abastecimiento', retiro_items: 'abastecimiento', ajustes_inventario: 'abastecimiento', ajuste_items: 'abastecimiento', numeradores: 'abastecimiento', movimientos_stock: 'abastecimiento', depositos: 'abastecimiento', usuarios_depositos: 'abastecimiento', sectores: 'abastecimiento',
  reparaciones: 'abastecimiento', reparacion_items: 'abastecimiento', reparacion_entregas: 'abastecimiento',
  // Mantenimiento: equipos (más adelante, manuales, órdenes de trabajo, mantenimiento programado)
  equipos: 'mantenimiento', equipo_items: 'mantenimiento',
};

const PUEDE_APUNTAR = {
  base: ['base'],
  abastecimiento: ['base', 'abastecimiento'],
  mantenimiento: ['base', 'abastecimiento', 'mantenimiento'],
};

export const puedeApuntar = (desde, hacia) => PUEDE_APUNTAR[desde]?.includes(hacia) ?? false;
