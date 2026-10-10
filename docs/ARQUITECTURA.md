# Arquitectura

## Piezas

| Pieza | Para qué | Dónde vive |
|---|---|---|
| **La app** (React + TypeScript + Vite) | Todas las pantallas | Un sitio por cliente (por ejemplo, Netlify) |
| **Supabase** (PostgreSQL, login, almacenamiento, funciones) | Los datos, los usuarios y los permisos | Un proyecto por cliente |
| **Servidor de archivos** (Node + Nginx + pm2) | Archivos pesados: manuales, despieces, planos | Un servidor propio (opcional) |

Todo el código es el mismo para todos los clientes. Lo propio de cada uno (nombre, logo, colores, módulos
activos, claves) está en su configuración y en su proyecto de Supabase: **no hay nada de ninguna empresa en el código.**

## Cómo se reparte la información

- **Datos chicos y relaciones** (repuestos, retiros, usuarios, proveedores, equipos, tareas...): en la base de Supabase.
- **Fotos livianas:** en el almacenamiento de Supabase, mientras pesen poco.
- **Archivos pesados:** en el servidor de archivos. En la base queda una *ficha* con el identificador del archivo;
  la app pide al servidor un link temporal cada vez que alguien lo quiere ver.

## Carpetas

```
src/
  auth/         sesión y perfil del usuario (el perfil se vuelve a leer solo cada minuto)
  components/   piezas compartidas (modales, avisos, menús, marca)
  features/     una carpeta por módulo: proveedores, comisionistas, rotulos, items (repuestos), retiros,
                reparaciones, tareas, admin, config...
  lib/          utilidades, tipos de la base, módulos (modulos.ts) y colores de marca (marca.ts)
  pages/        pantallas principales (Directorio, Depósito, Configuración, Ingreso)
supabase/
  migrations/   la base de datos, en orden (esquema base + mejoras de la plantilla)
  functions/    crear, resetear y eliminar usuarios
servidor-manuales/   el servidor de archivos
scripts/             cliente.mjs (instalar y actualizar clientes) y pruebas/integracion.mjs
docs/                esta documentación
clientes/            datos privados de cada cliente (no se sube a Git)
```

## Módulos y marca

- **Módulos** (tabla `licencia`): proveedores, comisionistas, envíos con rótulos, depósito de mantenimiento y tareas. Los
  define quien vende con `pnpm cliente modulos`, no el cliente. Un módulo apagado se **bloquea en la base de datos** (ver
  `SEGURIDAD.md`) y la app oculta lo que ya no se puede usar. La lista y sus dependencias están en `src/lib/modulos.json`,
  que leen tanto la app como el comando.
- **Los módulos no son independientes, y no tienen por qué serlo.** Hay tres tipos de relación:
  1. *Dependencia obligatoria:* `envios` necesita `proveedores` (cada envío es de un proveedor); si falta, no se puede
     activar. El comando lo valida y la app lo respeta.
  2. *Integración entre dos módulos:* las reparaciones y los proveedores por repuesto (parte del Depósito) existen solo si
     también está `proveedores`; elegir un comisionista al armar un envío existe solo si también está `comisionistas`.
  3. *Independientes:* `comisionistas`, `deposito` (su núcleo) y `tareas`.
  Las tablas siempre existen; lo que cambia es el acceso. Por eso un módulo se puede apagar y volver a prender sin perder datos.
- **Un módulo nuevo nace apagado** (solo está activo lo que la licencia dice de forma expresa). Cómo se agrega uno: `NUEVO-MODULO.md`.
- **Asistente de configuración inicial** (`src/features/inicial`): se abre solo la primera vez que entra el dueño y reúne,
  paso a paso, las pantallas de configuración de los módulos activos. Queda siempre en *Configuración → General*.
- **Marca** (`configuracion.color_primario` y `color_deposito`): dos colores; el resto de las variantes se
  derivan en `src/lib/marca.ts` y se aplican como variables CSS. Sin color guardado, rigen los colores
  originales de `src/styles/variables.css`. Se valida que el texto blanco se lea sobre el color elegido.

## Base de datos

- `20260101000000_esquema_base.sql`: esquema completo (27 tablas, políticas, funciones, disparadores, almacenamiento),
  generado a partir de una instalación real y verificado contra ella. Sin ningún dato.
- `20260101000100_mejoras_plantilla.sql`: usuarios nuevos con acceso activo, `definir_dueno_inicial` y retiro de la
  transferencia de dueño vieja.
- `20260101000200_modulos_y_marca.sql`: colores de marca (y la primera versión de los módulos, que `...0300` mueve a la licencia).
- `20260101000300_licencia_y_bloqueo_de_modulos.sql`: la licencia, el bloqueo por módulo y su historial.
- `20260101000400_configuracion_inicial.sql`: marca de cierre del asistente de configuración inicial.
- `20260101000500_modulos_apagados_por_defecto.sql`: lo que no figura en la licencia está apagado.
- `20260101000600_cierre_de_lecturas_publicas.sql`: sin sesión solo se lee la configuración (contactos y planilla de familias
  eran públicos); se quitan los permisos de tabla del rol sin sesión y se cierran las funciones que quedaban abiertas.
- `20260101000700_usuarios_bloqueados_sin_permisos.sql`: `usuario_activo()`; los permisos (dueño, administradores, ver retiros, etc.)
  exigen un usuario activo y cada tabla y las carpetas de archivos suman la regla `requiere_usuario_activo`.
- `20260101000900_ajuste_de_inventario.sql`: el permiso `puede_ajustar_inventario`, las tablas `ajustes_inventario` y `ajuste_items` (no se editan ni se
  borran; solo se anulan), las funciones `crear_ajuste_inventario`, `anular_ajuste_inventario` e `historial_ajustes_por_item`, y su registro en el historial del sistema.
- `20260101000800_zona_horaria_de_la_empresa.sql`: `configuracion.zona_horaria`, `hoy_local()` y `fecha_local()`; las tareas y la
  corrección de retiros "del mismo día" usan el día de la empresa y no el de la hora universal.

Una migración nueva se agrega como un archivo con fecha mayor; `pnpm cliente actualizar` la aplica en cada cliente.
**Nunca se edita una migración que ya se aplicó en algún cliente.**
