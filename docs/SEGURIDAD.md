# Seguridad

## Quién puede qué

Los permisos los impone **la base de datos** (políticas de seguridad por fila), no la pantalla. La pantalla solo
muestra u oculta botones para que la experiencia tenga sentido.

Cada persona tiene en `usuarios_perfil`:

- **Rol en Directorio:** `user`, `admin` o `disabled`.
- **Rol en el Depósito:** sin acceso, `comun` o `admin`.
- **Permisos sueltos:** ver los retiros de todos, ver el log de errores, resetear contraseñas, ver sugerencias.
- **Dueño** (`es_owner`): puede crear, eliminar y editar usuarios, ver el historial completo y administrar todo.
  **Puede haber varios dueños, todos con el mismo poder**, y el sistema nunca queda sin ninguno.

## Protecciones que verifica la prueba de integración

- Un usuario común **no puede** ascenderse, darse permisos ni hacerse dueño. Solo puede cambiar su nombre y apellido.
- Solo un dueño cambia roles, permisos y bloqueos de otros.
- A un dueño no se lo puede bloquear ni eliminar (ni desde la app ni desde las funciones del servidor): primero se
  le quita el cargo. No se puede quitar al último.
- El primer dueño se define una sola vez, al instalar, con la clave de servicio. Después esa función se rechaza.
- Sin sesión no se ve ningún dato privado.
- Un módulo apagado no se puede leer ni escribir (tablas, funciones y archivos), y cada cambio de la licencia queda en el historial.
- Cada cambio de repuestos (a mano), de retiros (correcciones y borrados), de usuarios, de proveedores, de comisionistas, de
  contactos y de reparaciones queda en el historial con quién lo hizo y qué cambió. El ajuste automático de stock que
  hace un retiro no se duplica. Restablecer una contraseña también queda registrado (nunca la contraseña).

## Cosas que son así a propósito

- **La configuración se puede leer sin iniciar sesión** (nombre, dirección, teléfono, email, logo y diseño del rótulo):
  la pantalla de ingreso muestra el nombre y el logo. No poner ahí nada que no deba ser público.
- **Los archivos de las carpetas públicas** (fotos de repuestos, rótulos) se pueden abrir con su dirección exacta aunque
  el módulo esté apagado; lo que el bloqueo impide es subir, borrar y listar. Las direcciones no se pueden adivinar.

## Licencia de módulos

Qué módulos tiene cada instalación lo define solo quien vende, con `pnpm cliente modulos` (clave de servicio). Vive en la
tabla `licencia`, que ningún usuario con sesión puede escribir (se probó con el dueño y con un usuario común). Un módulo
apagado queda **bloqueado para todos, incluido el dueño**, con una regla de seguridad por tabla (22 tablas), una por carpeta
de archivos (3) y una guarda en las funciones del servidor que se saltan las reglas de tabla (9, más 3 consultas). **Solo
está activo lo que la licencia dice de forma expresa:** un módulo que no figura (por ejemplo, uno nuevo) está apagado. Los
módulos que dependen de otros se bloquean si falta alguno (por ejemplo, las reparaciones necesitan Depósito y Proveedores).

## Qué no queda en el historial (todavía)

Envíos (rótulos), configuración de la empresa y del rótulo, sectores, familias y subfamilias, y proveedores por repuesto.
El historial muestra los últimos 200 movimientos.

## Para cada instalación

- Desactivar el registro público en Supabase (*Authentication → Sign In / Providers*). Ver `NUEVO-CLIENTE.md`.
- La clave de servicio y la contraseña de la base **nunca** van en el hosting ni en Git: solo en `clientes/` (privado)
  y como secreto de las funciones.
- Las claves públicas (`VITE_SUPABASE_*`) sí van en el hosting; están pensadas para eso, porque los permisos reales
  están en la base.
