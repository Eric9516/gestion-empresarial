# Arquitectura

## Piezas

| Pieza | Para qué | Dónde vive |
|---|---|---|
| **La app** (React + TypeScript + Vite) | Todas las pantallas | Un sitio por cliente (por ejemplo, Netlify) |
| **Supabase** (PostgreSQL, login, almacenamiento, funciones) | Los datos, los usuarios y los permisos | Un proyecto por cliente, en la cuenta del cliente (plan Pro a su cargo) |
| **Panel de administración** (`panel/`) | Crear clientes, actualizarlos, cambiar sus módulos e instalarles componentes, desde el celular | Un servidor propio, detrás de Tailscale (ver [PANEL-DISENO.md](PANEL-DISENO.md)) |
| **Servidor de archivos** (Node + Nginx + pm2) | Archivos pesados: manuales, despieces, planos | Un servidor propio (opcional, todavía no conectado) |

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
                reparaciones, tareas, admin (incluye la pantalla de Módulos del dueño), config...
  lib/          utilidades, tipos de la base, módulos (modulos.ts + modulos.json) y colores de marca (marca.ts)
  pages/        pantallas principales (Directorio, Depósito, Configuración, Ingreso)
supabase/
  componentes/  la base de datos, por componente (base, abastecimiento, mantenimiento), en orden
  migrations/   las 11 migraciones originales: CONGELADAS (historial de Cremac y referencia de la prueba de equivalencia)
  functions/    crear, resetear y eliminar usuarios
panel/               el panel de administración (proyecto aparte, con sus propias dependencias y pruebas)
servidor-manuales/   el servidor de archivos
scripts/             cliente.mjs (instalar y actualizar clientes), herramientas/ (lógica de componentes y partición)
                     y pruebas/ (integración con un Supabase real y esquema en memoria)
docs/                esta documentación
clientes/            datos privados de cada cliente (no se sube a Git)
```

## Módulos, componentes y licencia

La base de datos de cada cliente se arma por **componentes** (Base, Abastecimiento, Mantenimiento) según los módulos que contrata; un módulo funciona
si la licencia lo incluye **y** el dueño no lo apagó. Todo el detalle (qué tabla es de qué componente, las dos llaves, cómo se instala y se amplía, cómo se
escribe una migración y qué prueba qué) está en [COMPONENTES.md](COMPONENTES.md). Cómo se agrega un módulo: [NUEVO-MODULO.md](NUEVO-MODULO.md).

- **Módulos hoy:** proveedores, comisionistas, envíos con rótulos, depósito, mantenimiento y tareas. La lista y sus dependencias están en `src/lib/modulos.json`.
- **Tres tipos de relación entre módulos:**
  1. *Dependencia obligatoria:* `envios` necesita `proveedores`; `mantenimiento` necesita `deposito`. Si falta, no se puede activar.
  2. *Integración entre dos módulos:* los proveedores por repuesto existen solo si están `deposito` y `proveedores`; las reparaciones, solo si están
     `mantenimiento`, `deposito` y `proveedores`; elegir un comisionista al armar un envío, solo si están `envios` y `comisionistas`.
  3. *Independientes:* `comisionistas`, `deposito` (su núcleo) y `tareas`.
  Las tablas de un componente instalado siempre existen; lo que cambia es el acceso. Por eso un módulo se puede apagar y volver a prender sin perder datos.
- **Un módulo nuevo nace apagado** (solo está activo lo que la licencia dice de forma expresa).
- **Asistente de configuración inicial** (`src/features/inicial`): se abre solo la primera vez que entra el dueño y reúne,
  paso a paso, las pantallas de configuración de los módulos activos. Queda siempre en *Configuración → General*.
- **Marca** (`configuracion.color_primario` y `color_deposito`): dos colores; el resto de las variantes se
  derivan en `src/lib/marca.ts` y se aplican como variables CSS. Sin color guardado, rigen los colores
  originales de `src/styles/variables.css`. Se valida que el texto blanco se lea sobre el color elegido.

## Base de datos

- Cada componente tiene su propia cadena de migraciones en `supabase/componentes/<componente>/`. Se aplican en el orden **base → abastecimiento → mantenimiento**
  y, dentro de cada uno, por número de versión. Una mejora nueva es un archivo nuevo dentro del componente que corresponde; **nunca se edita una migración que ya
  se aplicó en algún cliente**. `pnpm cliente actualizar` (o el panel) la aplica en cada cliente.
- Lo que hacen las migraciones, en resumen: el esquema base (sin ningún dato de empresa); usuarios nuevos con acceso activo y `definir_dueno_inicial`; colores de marca;
  la licencia y el bloqueo por módulo con su historial; el asistente de configuración inicial; sin sesión solo se lee la configuración; los usuarios bloqueados no
  pueden nada (`usuario_activo()` y la regla `requiere_usuario_activo` en cada tabla y carpeta de archivos); la zona horaria de la empresa (`hoy_local()`); el ajuste
  de inventario (que no se edita ni se borra, solo se anula); el diseño de rótulo predeterminado sin clave desde la Base; y, ya por componentes, la licencia con
  componentes instalados, el interruptor del dueño y Mantenimiento como módulo propio.
- Las 11 migraciones originales (`supabase/migrations/`) se conservan congeladas; las migraciones por componente dan **exactamente el mismo esquema** (lo prueba
  `pnpm pruebas:esquema`).
