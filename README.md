# Gestión empresarial

Plantilla de aplicación interna para empresas, por módulos: proveedores, comisionistas, envíos con rótulos, depósito (repuestos, stock, retiros, ajustes, reposición y reparaciones: lo que se manda a reparar afuera), mantenimiento (equipos) y tareas. Cada cliente recibe solo los módulos que contrata. Los datos propios de cada empresa (nombre, logo, dirección, diseño de rótulos) se cargan desde **Configuración**, no están en el código.

> **Estado:** plantilla en construcción, derivada de una instalación real. La base de datos se arma por componentes y se instala
> sin datos con un solo comando (ver [docs/NUEVO-CLIENTE.md](docs/NUEVO-CLIENTE.md)), o desde el panel de administración. Lo que falta para ofrecerla a
> otras empresas está en [docs/PENDIENTES.md](docs/PENDIENTES.md).

## Documentación

- [**Manual paso a paso** (instalar, módulos, permisos, entrega, problemas)](docs/MANUAL-PASO-A-PASO.md)
- [Instalar y actualizar un cliente (versión corta)](docs/NUEVO-CLIENTE.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Componentes, módulos y licencia](docs/COMPONENTES.md)
- [Agregar un módulo nuevo](docs/NUEVO-MODULO.md)
- [Seguridad y permisos](docs/SEGURIDAD.md)
- [Pruebas: qué hay, qué cubre y qué no](docs/PRUEBAS.md)
- [Trabajar con alguien que desarrolla solo las pantallas](docs/DESARROLLO-CON-SOCIO.md)
- [Plan del producto (hacia dónde crece)](docs/PLAN-PRODUCTO.md)
- [Pendientes para que sea un producto](docs/PENDIENTES.md)
- **Panel de administración de clientes (carpeta `panel/`)**: [diseño](docs/PANEL-DISENO.md) · [informe de seguridad](docs/PANEL-SEGURIDAD.md) · [instalación paso a paso](docs/PANEL-INSTALACION.md)
- [Servidor de archivos](servidor-manuales/README.md)

## Tecnología

- React 19 + TypeScript + Vite
- Supabase (base PostgreSQL, login, Storage y Edge Functions)
- TanStack Query para datos, Vitest para pruebas, Oxlint para lint

## Puesta en marcha

Requisitos: Node.js 20.19 o superior y [pnpm](https://pnpm.io) (`npm install -g pnpm`).

```bash
pnpm install
```

Copiar `.env.example` a `.env` y completar las dos variables (ver abajo). Después:

```bash
pnpm dev
```

### Variables de entorno (`.env`)

| Variable | Qué es |
|---|---|
| `VITE_SUPABASE_URL` | Dirección del proyecto de Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública ("publishable") del proyecto |

El archivo `.env` no se sube a git. En producción se configuran como variables del servicio de hosting.

Variables opcionales para Sentry (reporte de errores):

| Variable | Qué es |
|---|---|
| `VITE_SENTRY_DSN` | Dirección del proyecto de Sentry. Sin ella no se envían errores |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Solo en el hosting. Con las tres, cada build sube a Sentry los mapas de código y los borra de lo publicado. El token es secreto |

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` | Chequea tipos y genera la versión de producción en `dist/` |
| `pnpm lint` | Revisa el código con Oxlint |
| `pnpm test` | Corre las pruebas |
| `pnpm cliente nuevo ...` | Crea el proyecto de Supabase de un cliente nuevo y lo deja instalado |
| `pnpm cliente actualizar --ref ...` | Aplica a un cliente las migraciones y funciones nuevas |
| `pnpm cliente modulos --ref ...` | Ve y cambia los módulos que tiene contratados un cliente (solo lo hace quien vende) |
| `pnpm cliente componente --ref ... --agregar ...` | Instala en un cliente un componente que no tenía (por ejemplo, Mantenimiento) sin tocar sus datos |
| `pnpm pruebas:esquema` | Prueba la base de datos desde cero en memoria: cadena original, cadena por componentes y equivalencia entre las dos |
| `pnpm pruebas:supabase-local` | La prueba de integración, el instalador, las combinaciones de módulos, la lógica y los 32.640 permisos, contra un Supabase local simulado (sin tocar proyectos reales) |
| `pnpm pruebas:integracion ...` | Prueba de punta a punta de una instalación de pruebas (contra un proyecto real de Supabase de pruebas) |

El panel de administración (carpeta `panel/`) tiene sus propios comandos: dentro de `panel/`, `pnpm test`, `pnpm run typecheck` y `pnpm build` (ver [docs/PANEL-INSTALACION.md](docs/PANEL-INSTALACION.md)).

Antes de subir cambios conviene que `pnpm build` y `pnpm test` pasen sin errores.

## Estructura

```
src/
  auth/         sesión y perfil del usuario
  components/   piezas compartidas (Modal, avisos, confirmaciones)
  features/     una carpeta por módulo: proveedores, comisionistas, rotulos,
                items (repuestos), retiros, reparaciones, tareas, admin, etc.
  lib/          utilidades, tipos de la base y generación de PDF
  pages/        pantallas principales (Directorio, Depósito, Configuración)
  routes/       protección de rutas
  styles/       hojas de estilo
supabase/
  componentes/  la base de datos, por componente (base, abastecimiento, mantenimiento), en orden
  migrations/   las 11 migraciones originales, congeladas (historial y referencia de pruebas)
  functions/    Edge Functions: create-user, delete-user, reset-password
panel/              panel de administración de clientes (proyecto aparte, con sus propias pruebas)
servidor-manuales/  servidor de archivos (manuales, despieces, planos)
scripts/            instalador de clientes, herramientas de componentes y pruebas (integración, esquema y Supabase local)
docs/               documentación
```

## Permisos

Hay dos ejes independientes, más indicadores sueltos, guardados en `usuarios_perfil`:

- **Directorio:** `user`, `admin` o `disabled`.
- **Depósito de mantenimiento** (`mantenimiento_rol`): sin acceso, `comun` o `admin`.
- **Dueño** (`es_owner`): puede crear usuarios y administrar todo. Puede haber varios; se agregan y quitan desde Configuración → Usuarios, y siempre queda al menos uno.
- Indicadores adicionales: ver todos los retiros, ver errores, resetear contraseñas, ver sugerencias.

Las reglas se aplican en la base (políticas RLS), no solo en la interfaz. Las funciones que se usan para chequear permisos en pantalla están en `src/lib/types.ts`.

## Base de datos

La base de cada cliente se instala y se actualiza con `pnpm cliente` (ver [docs/NUEVO-CLIENTE.md](docs/NUEVO-CLIENTE.md)).
Las migraciones están en `supabase/componentes/<componente>/` (base, abastecimiento, mantenimiento), en orden; una mejora nueva es un
archivo nuevo dentro del componente que corresponde, y nunca se edita uno que ya se aplicó. Cada cliente recibe solo los componentes
de los módulos que contrata (`supabase/migrations/` quedó congelada como historial; ver [docs/COMPONENTES.md](docs/COMPONENTES.md)).

Las Edge Functions necesitan el secreto `PROJECT_SECRET_KEY` (la clave de servicio del proyecto); el instalador lo
configura y las publica.

## Errores

Los errores de la app se guardan en la tabla `error_logs` y se ven en Configuración → Errores (para usuarios con ese permiso). Además se envían a Sentry si está configurado, y una pantalla que se rompe muestra un cartel con la opción de recargar en vez de quedar en blanco.
