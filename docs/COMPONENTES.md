# Componentes, módulos y licencia

Cómo está repartida la base de datos de cada cliente y quién decide qué funciona. Es la referencia viva; la historia de cómo se llegó
a esto ya no hace falta.

## 1. Los componentes

La base de datos se arma por **componentes**. Cada cliente recibe solo los que contrata: **lo que no se contrata no existe en su base**
(ni sus tablas, ni sus funciones, ni sus reglas), así que no hay nada que "abrir" por la fuerza.

| Componente | Tablas | Carpetas de archivos |
|---|---|---|
| **Base** (siempre) | `usuarios_perfil`, `configuracion`, `licencia`, `preferencias_modulos`, `audit_log`, `error_logs`, `sugerencias`, `tasks`, `task_history` | — |
| **Abastecimiento** | `proveedores`, `contactos`, `comisionistas` · `rotulos_generados`, `rotulos_bultos`, `rotulos_fotos`, `rotulo_disenos` · `items`, `familias`, `subfamilias`, `planilla_familias`, `item_proveedores` · `retiros`, `retiro_items`, `ajustes_inventario`, `ajuste_items`, `sectores` · `reparaciones`, `reparacion_items`, `reparacion_entregas` | `items`, `rotulos` |
| **Mantenimiento** | `equipos`, `equipo_items` | `documentos` |

**Regla de dependencias** (siempre en una sola dirección): la Base no depende de nada; Abastecimiento depende de la Base; Mantenimiento
depende de la Base y de Abastecimiento. La prueba de esquema la vigila (ninguna clave entre tablas puede ir al revés). Los permisos por
módulo que viven en el perfil del usuario (rol del depósito, ver todos los retiros, ajustar inventario) son solo banderas: se quedan en la Base.

Los planes comerciales son combinaciones de componentes (ver [PLAN-PRODUCTO.md](PLAN-PRODUCTO.md)): hoy, **Plan 1 = Base + Abastecimiento** y
**Plan 2 = Base + Abastecimiento + Mantenimiento** (Cremac).

## 2. Módulos y componentes

Un **módulo** es lo que el cliente ve y contrata; un **componente** es de dónde salen sus tablas. La lista (con sus dependencias) está en
`src/lib/modulos.json`, que leen la app, el instalador y el panel.

| Módulo | Componente | Necesita |
|---|---|---|
| `tareas` | Base | — |
| `proveedores` | Abastecimiento | — |
| `comisionistas` | Abastecimiento | — |
| `envios` | Abastecimiento | `proveedores` |
| `deposito` | Abastecimiento | — (las reparaciones y los proveedores por repuesto, además, `proveedores`) |
| `mantenimiento` | Mantenimiento | `deposito` |

Los componentes que se instalan salen de los módulos contratados: solo Tareas → Base; Proveedores, Comisionistas, Envíos o Depósito → Base +
Abastecimiento; Mantenimiento → los tres.

## 3. Las dos llaves de un módulo

Un módulo funciona solo si se cumplen **las dos**:

1. **La licencia** (tabla `licencia`): la define **solo quien vende**, con la clave de servicio (`pnpm cliente modulos` o el panel). Dice qué módulos
   incluye el plan y qué componentes están instalados (`licencia.componentes`, que se anota solo con la primera migración de cada componente).
   Un módulo que no figura expresamente como activo está apagado: uno nuevo nace apagado para todos.
2. **El interruptor del dueño** (tabla `preferencias_modulos`): el dueño puede apagar, dentro de su plan, los módulos que no usa
   (*Configuración → General → Módulos*). Nadie escribe esa tabla directo: se cambia solo con la función `definir_modulo_del_dueno(módulo, apagado)`, que:
   * exige un dueño activo;
   * no deja prender nada que la licencia no incluya;
   * no deja apagar un módulo que otro prendido necesita (ni prender uno al que le falta lo que necesita);
   * deja anotado en el historial quién lo hizo.

`modulo_activo(módulo)` exige las dos llaves, y todas las reglas de bloqueo (una por tabla, una por carpeta de archivos y una guarda en cada
función que se salta las reglas de tabla) llaman a esa función: por eso respetan las dos sin tocarlas una por una. Un módulo apagado queda
bloqueado **para todos, incluido el dueño**; los datos no se borran y vuelven al prenderlo.

`modulo_requisitos()` (en la base) tiene que coincidir con `requiere` de `modulos.json`: la prueba de esquema lo comprueba.

> **Qué no impide la licencia:** quien tenga las claves de administración de su propio proyecto de Supabase puede editar la tabla `licencia`.
> Lo que sí impide encender lo no contratado es que **sus tablas no estén instaladas** (apartado 1). Por eso los componentes se instalan por contrato.

## 4. Cómo se instala y se amplía

* **Cliente nuevo:** `pnpm cliente nuevo ... --modulos a,b,c` o, desde el panel, *Nuevo cliente*. Instala solo los componentes de esos módulos.
* **Ampliar sin perder datos:** `pnpm cliente componente --ref X --agregar mantenimiento [--confirmo]` o, en el panel, *Instalar componente* en el detalle
  del cliente (se firma con la llave de acceso). Los módulos del componente nuevo quedan apagados hasta que se activen. No se instala dos veces, ni
  sin sus requisitos, ni la Base; y no se puede activar un módulo cuyo componente no está instalado.
* **Actualizar:** `pnpm cliente actualizar --ref X` (o *Actualizar este cliente* en el panel) aplica las migraciones que falten **de los componentes que el
  cliente ya tiene**.
* **Registro de lo aplicado:** tabla `migraciones_aplicadas`, con nombres `componente/archivo.sql`. Un registro de antes de existir los componentes (solo
  `archivo.sql`) vale como instalación **completa** de esa migración: Cremac y la copia de pruebas siguen funcionando y solo reciben lo que se agregó después.
* La lógica "qué componentes salen de estos módulos / cuáles tiene ya este cliente" está escrita dos veces a propósito: `scripts/herramientas/componentes.mjs`
  (instalador) y `panel/src/server/componentes.ts` (panel). Una prueba con datos al azar vigila que decidan siempre igual.

## 5. Cómo se escribe una migración

* Va **dentro de la carpeta del componente** que corresponde: `supabase/componentes/{base,abastecimiento,mantenimiento}/AAAAMMDDHHMMSS_nombre.sql`.
  Si toca cosas de dos componentes, se parte en un archivo por componente (la Base primero). Nunca se edita una migración ya aplicada en algún cliente.
* Una tabla nueva se anota en `scripts/pruebas/esquema/componentes.mjs`; si no, la prueba falla. También hay que escribirle a mano su regla
  `requiere_usuario_activo` (la que bloquea a los usuarios desactivados): el bucle automático solo recorrió las tablas que existían cuando se armó la cadena.
* Cada función nueva se cierra: `revoke execute ... from public, anon;` y un `grant` a quien corresponda.
* Un componente no puede nombrar nada de otro componente "más alto". Ver [NUEVO-MODULO.md](NUEVO-MODULO.md) para el recorrido completo de un módulo nuevo.
* `supabase/migrations/` (las 11 migraciones originales) quedó **congelada**: es el historial de Cremac y la referencia de la prueba de equivalencia. No se agrega nada ahí.

## 6. Pruebas

`pnpm pruebas:esquema` corre, sobre un PostgreSQL en memoria con las piezas de Supabase simuladas:

1. La batería de instalación y seguridad sobre la **cadena original** (permisos, módulos, ajustes de inventario, tareas, sin acceso sin sesión, etc.).
2. La misma batería sobre la **cadena por componentes** (`--componentes`), más las pruebas de la licencia y el interruptor del dueño.
3. `equivalencia.mjs`: Base + Abastecimiento + Mantenimiento dejan **exactamente el mismo esquema** que las 11 migraciones originales (883 piezas, comparadas contra
   la foto `esquema-de-referencia.json`); cada plan instala solo lo suyo (ninguna pieza nombra algo de un componente no instalado); ampliar con Mantenimiento
   más tarde da lo mismo que instalar todo junto y no pierde datos. Si la foto tuviera que cambiar a propósito: `node scripts/pruebas/esquema/equivalencia.mjs --regenerar`.

Se verificó además contra un **PostgreSQL 18 real** (no solo el simulado): las tres piezas dieron el mismo resultado. Hay más pruebas (instalador, permisos, módulos, lógica) contra un Supabase local
simulado y la prueba contra un proyecto real de pruebas: todo el mapa está en [PRUEBAS.md](PRUEBAS.md).

## 7. Herramientas de la partición (históricas)

`scripts/herramientas/{sql,clasificar,repartir}.mjs` armaron `supabase/componentes/` a partir de las 11 migraciones originales, sin reescribir SQL a mano: cada
sentencia se copió al componente más alto que nombra. Se conservan como registro de cómo se hizo (`node scripts/herramientas/repartir.mjs` muestra el reparto sin escribir nada).
Las migraciones nuevas ya no pasan por ahí.

## 8. Pase de Cremac

Aplicar a Cremac las migraciones nuevas (`...1100_*` de cada componente) **antes** de publicar esta versión de la app. Pasos exactos en el capítulo 10 del [manual](MANUAL-PASO-A-PASO.md).

### Las reparaciones son del Depósito (2026-10-14)

Una reparación es lo que se manda a reparar afuera: un proveedor (el taller), repuestos del depósito y un envío. No usa los equipos. Por eso sus tablas (`reparaciones`, `reparacion_items`,
`reparacion_entregas`) y sus funciones son del componente **Abastecimiento**, y las bloquea la licencia de `deposito` y `proveedores`, no la de `mantenimiento`. Mantenimiento queda para los equipos y para lo
que se agregue (manuales, órdenes de trabajo). Cómo se hizo: se movieron en `scripts/pruebas/esquema/componentes.mjs` (y la función `fn_audit_log_reparaciones` en `scripts/herramientas/clasificar.mjs`) y se regeneraron las partes
de cada componente con `scripts/herramientas/repartir.mjs`; `abastecimiento/20260101001300_reparaciones_en_el_deposito.sql` deja las bases que ya existían (Cremac) como una instalación nueva (es idempotente).
