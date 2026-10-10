# Agregar un módulo nuevo

Un módulo es una parte del sistema que se vende por separado (hoy: proveedores, comisionistas, envíos, depósito y tareas).
**Un módulo nuevo nace apagado en todos los clientes**: no llega a nadie hasta que se lo activa con
`pnpm cliente modulos`. Esta es la lista de lo que hay que hacer, en orden.

## 1. Definirlo

- `src/lib/modulos.json`: agregar una entrada con `id`, `nombre`, `descripcion`, `requiere` (los módulos sin los que no
  puede funcionar) y `bloquea` (qué queda bloqueado al apagarlo, para el mensaje del comando).
- `src/lib/modulos.ts`: sumar el `id` al tipo `ModuloId`. Si el módulo cruza funciones con otro, agregar la integración en
  `integraciones()`.

## 2. La base de datos (una migración nueva, con fecha mayor que la última)

- Las tablas del módulo, con sus permisos y sus disparadores de historial.
- **Una regla de bloqueo por tabla**, igual a las de `20260101000300_licencia_y_bloqueo_de_modulos.sql`:

  ```sql
  create policy bloqueo_modulo on public.mi_tabla as restrictive for all to public
    using (public.modulo_activo('mi_modulo')) with check (public.modulo_activo('mi_modulo'));
  ```

  Si la tabla necesita dos módulos a la vez, se combinan con `and`.
- **Una regla de "usuario activo" por tabla** (la prueba de integración falla si falta, y también si una tabla queda con permisos
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
- Si el módulo guarda archivos, una regla de bloqueo sobre su carpeta (ver las tres de la misma migración).
- **No** agregarlo a la tabla `licencia`: al no figurar, está apagado. Es lo que garantiza que nadie lo reciba sin comprarlo.

## 3. La app

- Mostrar sus pantallas solo si `useModulos().modulos.mi_modulo` es verdadero (ver `DirectorioPage` y `MantenimientoPage`).
- Si tiene pantallas de configuración, en `AdminPage` se declaran con `modulo: 'mi_modulo'`.
- Si necesita datos de arranque, un paso en `src/features/inicial/ConfiguracionInicial.tsx`.

## 4. Las pruebas

- Agregar sus tablas al mapa `NECESITA` de `scripts/pruebas/integracion.mjs`, con una fila de ejemplo en la sección que
  siembra datos. La matriz que apaga cada módulo las incluye sola.
- Pruebas unitarias de lo que tenga lógica propia.

## 5. Llevarlo a los clientes

1. `pnpm cliente actualizar --ref IDENTIFICADOR` en cada cliente: le suma la base nueva. **El módulo sigue apagado.**
2. Cuando el cliente lo compra: `pnpm cliente modulos --ref IDENTIFICADOR --activar mi_modulo --confirmo`.
3. La app se actualiza sola al subir los cambios a GitHub.
