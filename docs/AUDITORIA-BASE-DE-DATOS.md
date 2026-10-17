# Auditoría de la base de datos (2026-10-17)

Se armó la base completa desde las migraciones (cadena por componentes) en una PostgreSQL en memoria y se recorrió el esquema final: 36 tablas,
124 funciones, todas las reglas de seguridad (RLS), índices, disparadores y carpetas de archivos. Se leyeron a mano las funciones delicadas y las
tres Edge Functions, y se consultó (solo lectura) la configuración de acceso del proyecto de Cremac. Arquitectura elegida: **A, endurecer el modelo
actual** (Supabase + RLS + funciones), llevando a funciones con control de rol solo las lecturas sensibles.

## Lo que ya estaba bien

- Todas las tablas con RLS; ninguna función propia ejecutable sin sesión; las funciones con privilegios tienen `search_path` fijo.
- El SQL dinámico de la búsqueda usa parámetros: sin inyección SQL.
- Stock nunca negativo y movimientos atómicos; paginación por cursor; búsqueda con índices trigram (2–11 ms con 200.000 repuestos).
- Las reglas viejas ya calculaban los permisos una vez por consulta.
- Cremac tiene **cerrado el registro público** de usuarios.

## Hallazgos

| # | Hallazgo | OWASP | Gravedad | Estado |
|---|---|---|---|---|
| 1 | Quien tiene "resetear contraseñas" podía cambiarle la clave a un **administrador** y entrar como él | A01 / A07 | Alta | ✅ Fase 1 |
| 2 | Los repuestos (stock, ubicación) los leía cualquiera con sesión; la búsqueda y el **Informe** solo pedían "usuario activo" | A01 | Alta | ✅ Fase 1 (lectura y funciones); la separación por depósito, Fase 2 |
| 3 | Las 3 carpetas de archivos son públicas, sin límite de tamaño ni de tipo; en rótulos sube cualquiera con sesión | A01 / A05 | Alta | Fase 3 |
| 4 | Una cuenta nueva nacía **activa** con acceso al Directorio (si quedara abierto el registro, entraba cualquiera) | A07 / A05 | Alta (latente) | ✅ Fase 1 |
| 5 | Contraseña mínima de 6 en Supabase y en las Edge Functions; sin captcha; la dirección del sitio de Cremac es `localhost:3000` | A07 / A05 | Media | ✅ Edge Functions y app en 8; falta la configuración de Supabase de cada cliente |
| 6 | Sin límites de tamaño en lo que escribe cualquier usuario (errores, sugerencias, textos libres) | A04 / A09 | Media | Fase 4 |
| 7 | Los usuarios con sesión tenían TRUNCATE / REFERENCES / TRIGGER en 29 tablas | A05 | Media-baja | ✅ Fase 1 |
| 8 | 63 reglas declaradas para "public" (incluye a quien no inició sesión) en vez de "authenticated" | A01 | Media-baja | Fase 4 |
| 9 | La configuración (CUIT, dirección, teléfono, email) la leen anónimos | A01 | Baja | Fase 4 |
| 10 | Edge Functions: CORS `*` y mensajes de error internos | A05 | Baja | Fase 4 |
| 11 | `usuarios_perfil` sin relación con la cuenta de acceso; `activo`, `rol` y `mantenimiento_rol` admiten vacío | A04 | Baja | Fase 4 |
| 12 | Copias de seguridad: verificar el plan de Supabase de cada cliente (el gratis no restaura) | Disponibilidad | Alta si es gratis | Fase 4 |
| 13 | La extensión de búsqueda (pg_trgm) está en el esquema público | A05 | Baja | Fase 4 |

**Rendimiento**

| Hallazgo | Estado |
|---|---|
| 8 reglas nuevas (movimientos, depósitos, archivos) calculaban "módulo activo" una vez por fila | ✅ Fase 1: una vez por consulta |
| Faltaba índice en `movimientos_stock.deposito_id` | ✅ Fase 1: `(deposito_id, created_at desc, id)` |
| Dos reglas de lectura en `tasks` y `task_history` | Fase 4 |
| `audit_log` y `error_logs` crecen sin techo | Fase 4 (retención; decisión legal de cuánto guardar) |
| La configuración se pide entera (logo, diseño de rótulos) en cada carga | Fase 4 |

## Fases

1. **✅ Fase 1 (migraciones `20260101002600_seguridad_fase_1.sql` y Edge Functions):** cuenta nueva bloqueada; sin TRUNCATE/REFERENCES/TRIGGER
   (también para las tablas futuras); repuestos, búsqueda y listas del Depósito solo con acceso al Depósito; Informe solo para administradores del
   Depósito; reglas una vez por consulta; índice de movimientos por depósito; resetear contraseñas solo de personas sin cargos ni permisos (la de un
   administrador la restablece un dueño); contraseña mínima de 8 en las funciones y en la app.
   Falta en cada cliente (configuración de Supabase, no está en el código): mínimo de 8 caracteres y la dirección del sitio correcta.
2. **Fase 2 (con la separación por depósito):** repuestos, movimientos y retiros visibles solo para cada depósito; permisos por depósito; retirar
   `mantenimiento_rol` (ver PENDIENTES.md).
3. **Fase 3 (archivos):** carpetas privadas con direcciones firmadas, límites de tamaño y de tipo, y solo quien corresponde sube a cada carpeta.
4. **Fase 4 (operación y orden):** respaldo automático y restaurable; retención del historial y de los errores; límites de largo en los textos;
   perfil atado a la cuenta y `activo` sin vacío; reglas para "authenticated" generadas automáticamente; configuración pública solo con nombre, logo
   y colores; CORS solo al dominio de cada cliente; mover pg_trgm fuera del esquema público.

"Que nada falle" no lo garantiza ningún sistema. El objetivo es que una falla no abra datos (varias capas), que se detecte sola (las pruebas corren
en cada cambio) y que se pueda recuperar (respaldos).
