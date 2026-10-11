# Agregar un módulo nuevo

Un módulo es una parte del sistema que se vende por separado (hoy: proveedores, comisionistas, envíos, depósito, mantenimiento y tareas).
**Un módulo nuevo nace apagado en todos los clientes**: no llega a nadie hasta que se lo activa con `pnpm cliente modulos` (o desde el panel).
Esta es la lista de lo que hay que hacer, en orden. Antes, leer [COMPONENTES.md](COMPONENTES.md): explica qué es un componente y las dos llaves de un módulo.

## 1. Definirlo

- Decidir **de qué componente es** (Base, Abastecimiento o Mantenimiento): de ahí salen sus tablas y, por lo tanto, quién lo puede tener.
- `src/lib/modulos.json`: agregar una entrada con `id`, `nombre`, `componente`, `descripcion`, `requiere` (los módulos sin los que no
  puede funcionar) y `bloquea` (qué queda bloqueado al apagarlo, para el mensaje del comando). Un módulo no puede requerir uno de un componente "más alto".
- `src/lib/modulos.ts`: sumar el `id` al tipo `ModuloId`. Si el módulo cruza funciones con otro, agregar la integración en `integraciones()`.
- Si tiene `requiere`, actualizar `modulo_requisitos()` en la base (en una migración de la Base): tiene que coincidir con `modulos.json` y la prueba de esquema lo comprueba.
  Esa lista es la que usa el interruptor del dueño para no dejar apagar ni prender en un orden imposible.

## 2. La base de datos (una migración nueva, con fecha mayor que la última, dentro de la carpeta de su componente)

La migración va en `supabase/componentes/<componente>/` (no en `supabase/migrations`, que quedó congelada). Si toca cosas de dos componentes, un archivo por componente, la Base primero.

- Las tablas del módulo, con sus permisos y sus disparadores de historial.
- **Anotar cada tabla en `scripts/pruebas/esquema/componentes.mjs`** (a qué componente pertenece). Si falta, la prueba falla. Una tabla no puede apuntar a otra de un componente "más alto".
- **Una regla de bloqueo por tabla**, igual a las que ya existen (ver `supabase/componentes/*/20260101000300_licencia_y_bloqueo_de_modulos.sql`):

  ```sql
  create policy bloqueo_modulo on public.mi_tabla as restrictive for all to public
    using (public.modulo_activo('mi_modulo')) with check (public.modulo_activo('mi_modulo'));
  ```

  Si la tabla necesita dos módulos a la vez, se combinan con `and`. `modulo_activo()` ya exige la licencia **y** que el dueño no lo haya apagado.
- **Una regla de "usuario activo" por tabla**, escrita a mano en la misma migración (la prueba falla si falta, y también si una tabla queda con permisos
  para quien no inició sesión):

  ```sql
  create policy requiere_usuario_activo on public.mi_tabla as restrictive for all to authenticated
    using ((select public.usuario_activo())) with check ((select public.usuario_activo()));
  ```
- **Cerrar cada función nueva.** Postgres le da permiso de ejecución a todo el mundo, incluso a quien no inició sesión:

  ```sql
  revoke execute on function public.mi_funcion(...) from public, anon;
  grant execute on function public.mi_funcion(...) to authenticated, service_role;
  ```
- **Una guarda en cada función del servidor** que se salta las reglas de tabla (las `security definer`):
  `perform public.exigir_modulo('mi_modulo');` como primera línea. Si decide por permisos, que use `is_owner()`,
  `is_directorio_admin()`, etc. (ya exigen usuario activo), o `usuario_activo()` si no hay otro control.
- **Fechas:** "hoy" se pide con `public.hoy_local()` (el día de la empresa), nunca con `current_date` (hora universal).
- Si el módulo guarda archivos, una regla de bloqueo sobre su carpeta (ver las de `...000300_licencia_y_bloqueo_de_modulos.sql`).
- **No** agregarlo a la tabla `licencia`: al no figurar, está apagado. Es lo que garantiza que nadie lo reciba sin comprarlo.
- La primera migración de un componente nuevo tiene que anotarlo en `licencia.componentes` (ver las `...001100_*` de los componentes existentes).

## 3. La app

- Mostrar sus pantallas solo si `useModulos().modulos.mi_modulo` es verdadero (ver `DirectorioPage` y `MantenimientoPage`). Esa lista ya descuenta lo que el dueño apagó
  y lo que no está instalado; la pantalla *Configuración → General → Módulos* muestra sola el módulo nuevo cuando el plan lo incluye.
- Si tiene pantallas de configuración, en `AdminPage` se declaran con `modulo: 'mi_modulo'`.
- Si necesita datos de arranque, un paso en `src/features/inicial/ConfiguracionInicial.tsx`.
- Los íconos se piden con `<Icono n="nombre" />` (`src/components/Icono.tsx`); nunca emojis ni símbolos sueltos (✓, ⋮, ●…): una prueba lo vigila. Si falta un ícono, se agrega una línea en ese archivo con un nombre que diga qué significa.

## 4. Las pruebas

- Agregar sus tablas al mapa `NECESITA` de `scripts/pruebas/integracion.mjs` (con una fila de ejemplo en la sección que siembra datos) y a los mapas `TABLAS`, `FUNCIONES` y `BUCKETS` de `scripts/pruebas/supabase-local/matriz-modulos.mjs`; sus operaciones, a `matriz-permisos.mjs`.
- `pnpm pruebas:esquema` (instalación desde cero, dependencias entre componentes, sin fugas hacia componentes no instalados) y `pnpm pruebas:supabase-local` tienen que seguir en verde (ver [PRUEBAS.md](PRUEBAS.md)).
- Pruebas unitarias de lo que tenga lógica propia.

## 5. Llevarlo a los clientes

1. `pnpm cliente actualizar --ref IDENTIFICADOR` (o *Actualizar este cliente* en el panel) en cada cliente: le suma la base nueva. **El módulo sigue apagado.**
   Si el cliente no tiene el componente del módulo, primero `pnpm cliente componente --ref IDENTIFICADOR --agregar <componente>` (o *Instalar componente* en el panel).
2. Cuando el cliente lo compra: `pnpm cliente modulos --ref IDENTIFICADOR --activar mi_modulo --confirmo`. Desde ahí el dueño lo puede apagar y prender dentro de su plan.
3. La app se actualiza sola al subir los cambios a GitHub. **Orden seguro:** primero la base de datos de cada cliente, después la app.

## Si hace falta un componente nuevo (por ejemplo, Administración)

Es un cambio mayor: una carpeta nueva en `supabase/componentes/`, su lugar en el orden (`ORDEN_COMPONENTES` y `NECESITA` en `scripts/herramientas/componentes.mjs` **y** en
`panel/src/server/componentes.ts`, más `panel/scripts/generar.mjs`, `scripts/pruebas/esquema/componentes.mjs` y `equivalencia.mjs`), y sus tablas anotadas. Las pruebas de `panel/test/componentes.test.ts`
comparan las dos lógicas con datos al azar y avisan si quedan distintas.
