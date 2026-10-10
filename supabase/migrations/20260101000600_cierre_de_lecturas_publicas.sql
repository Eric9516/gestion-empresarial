-- Sin sesión solo se puede leer la configuración de la empresa (nombre, logo y colores del ingreso).
--
-- Hallazgo de la prueba exhaustiva: las reglas de lectura de "contactos" y "planilla_familias" estaban abiertas
-- al público y la clave pública va dentro del código de la página, así que cualquiera podía bajar los contactos
-- de los proveedores (nombre, cargo, teléfono y mail). Además, el rol sin sesión ("anon") tenía todos los permisos
-- de tabla y dependía solo de las reglas de fila.

alter policy contactos_select on public.contactos to authenticated;
alter policy planilla_familias_select on public.planilla_familias to authenticated;

-- Sin sesión no hace falta ningún permiso de tabla, salvo leer la configuración.
revoke all on all tables in schema public from anon;
grant select on public.configuracion to anon;
revoke all on all sequences in schema public from anon;

-- Que las tablas que se creen más adelante tampoco queden abiertas sin sesión.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Estas dos funciones se podían ejecutar sin sesión (solo informan si un módulo está activo).
revoke execute on function public.exigir_modulo(variadic text[]) from public, anon;
revoke execute on function public.modulo_activo(text) from public, anon;
grant execute on function public.exigir_modulo(variadic text[]) to authenticated, service_role;
grant execute on function public.modulo_activo(text) to authenticated, service_role;

-- Dos ayudantes del historial también se podían ejecutar sin sesión.
revoke execute on function public._aud_actor() from public, anon;
revoke execute on function public._aud_cambio(text, text, text) from public, anon;
grant execute on function public._aud_actor() to authenticated, service_role;
grant execute on function public._aud_cambio(text, text, text) to authenticated, service_role;
