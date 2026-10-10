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
- **Sin sesión solo se lee la configuración de la empresa** (nombre, logo y colores del ingreso). El rol sin sesión no tiene
  ningún permiso de tabla ni puede ejecutar funciones propias. La prueba lo comprueba tabla por tabla y funciona como alarma:
  si una tabla o función nueva queda abierta, falla.
- **Un usuario bloqueado no puede nada en la base**, aunque ya tenga la sesión abierta o entre por la API directa: ni lee, ni
  escribe, ni sube archivos, ni ejecuta funciones. Solo lee su propio perfil (la pantalla lo necesita para avisarle que su cuenta
  está desactivada y cerrarle la sesión, lo que hace en menos de un minuto). Una regla de seguridad por tabla (`requiere_usuario_activo`)
  se suma a todas las demás.
- **"Hoy" es el día de la empresa**, no el de la hora universal: la zona horaria se elige en *Configuración → Empresa* (por defecto
  Argentina). De 21:00 a 24:00 en Argentina ya es "mañana" en hora universal; antes eso impedía crear tareas.
- Eliminar usuarios solo requiere ser dueño (antes también exigía ser administrador del Directorio, aunque la pantalla mostraba el botón).
- Un módulo apagado no se puede leer ni escribir (tablas, funciones y archivos), y cada cambio de la licencia queda en el historial.
- Cada cambio de repuestos (a mano), de retiros (correcciones y borrados), de usuarios, de proveedores, de comisionistas, de
  contactos y de reparaciones queda en el historial con quién lo hizo y qué cambió. El ajuste automático de stock que
  hace un retiro no se duplica. Restablecer una contraseña también queda registrado (nunca la contraseña).

## Cosas que son así a propósito

- **La configuración se puede leer sin iniciar sesión** (nombre, dirección, teléfono, email, logo, colores, zona horaria y diseño
  del rótulo): la pantalla de ingreso muestra el nombre y el logo. No poner ahí nada que no deba ser público.
- **Las funciones nuevas hay que cerrarlas a mano.** Postgres da permiso de ejecución a todo el mundo a cada función que se crea.
  Cada función nueva lleva `revoke execute ... from public, anon` y un `grant` a quien corresponda (ver `NUEVO-MODULO.md`).
- **Los archivos de las carpetas públicas** (fotos de repuestos, rótulos) se pueden abrir con su dirección exacta aunque
  el módulo esté apagado; lo que el bloqueo impide es subir, borrar y listar. Las direcciones no se pueden adivinar.

## Ajuste de inventario

Sumar o restar stock de varios repuestos de una vez (para corregir lo que salió o entró sin anotarse). Las reglas:

- **Permiso propio** ("Puede ajustar el inventario"): solo lo da un dueño, solo sirve para administradores del Depósito, y los dueños siempre lo tienen.
  Darlo o sacarlo queda en el historial.
- **No se edita ni se borra, ni con la clave de servicio, ni vaciando las tablas:** la protección está en la base (disparadores), no en la pantalla.
  Un error lo **anula un dueño**: el ajuste queda en la lista como anulado (quién, cuándo y por qué) y el stock vuelve a como estaba.
- **Restar nunca deja el stock en negativo**, y un ajuste es todo o nada: si una línea falla, no queda ninguna.
- **El historial del sistema registra todo:** el ajuste, cada línea (suma o resta, cuánto, stock de antes y de después, motivo, quién), la anulación
  (cabecera y una fila por línea) y el cambio del permiso. El cambio de stock que hace el ajuste no se duplica como edición suelta del repuesto.
- Los ajustes los lee quien puede ajustar; el historial de **un** repuesto lo ve cualquiera del Depósito (igual que sus retiros).
- Pertenece al módulo **Depósito**: apagado, no se ajusta, no se anula, no se lee (ni el dueño). Al volver a prenderlo, los ajustes siguen ahí.
- Para limpiar una instalación **de pruebas** hace falta apagar esas protecciones solo en la sesión (`session_replication_role = replica`); la prueba automática lo hace.

## Licencia de módulos

Qué módulos tiene cada instalación lo define solo quien vende, con `pnpm cliente modulos` (clave de servicio). Vive en la
tabla `licencia`, que ningún usuario con sesión puede escribir (se probó con el dueño y con un usuario común). Un módulo
apagado queda **bloqueado para todos, incluido el dueño**, con una regla de seguridad por tabla (24 tablas), una por carpeta
de archivos (3) y una guarda en las funciones del servidor que se saltan las reglas de tabla (9, más 3 consultas). **Solo
está activo lo que la licencia dice de forma expresa:** un módulo que no figura (por ejemplo, uno nuevo) está apagado. Los
módulos que dependen de otros se bloquean si falta alguno (por ejemplo, las reparaciones necesitan Depósito y Proveedores).

## Qué no queda en el historial (todavía)

Envíos (rótulos), configuración de la empresa y del rótulo, sectores, familias y subfamilias, y proveedores por repuesto.
Tampoco queda **el alta de un retiro** (sí sus correcciones y borrados): registrar cada retiro llenaría el historial de ruido.
El historial muestra los últimos 200 movimientos.

## Para cada instalación

- Desactivar el registro público en Supabase (*Authentication → Sign In / Providers*). Ver `NUEVO-CLIENTE.md`. El instalador
  lo comprueba al terminar (`nuevo` y `actualizar`) y avisa en pantalla si sigue abierto.
- La clave de servicio y la contraseña de la base **nunca** van en el hosting ni en Git: solo en `clientes/` (privado)
  y como secreto de las funciones.
- Las claves públicas (`VITE_SUPABASE_*`) sí van en el hosting; están pensadas para eso, porque los permisos reales
  están en la base.
