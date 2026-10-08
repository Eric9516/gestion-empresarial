# Gestión empresarial

Plantilla de aplicación interna para empresas: proveedores, comisionistas, envíos con rótulos, depósito de mantenimiento (repuestos, stock, retiros, reparaciones, reposición) y tareas. Los datos propios de cada empresa (nombre, logo, dirección, diseño de rótulos) se cargan desde **Configuración**, no están en el código.

> **Estado:** proyecto en construcción, derivado de una instalación real. Falta el script de base de datos limpio (`supabase/migrations/` está vacío a propósito): hasta que se arme, no se puede iniciar sesión en una instalación nueva.

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
  migrations/   cambios de la base, en orden
  functions/    Edge Functions: create-user, delete-user, reset-password
```

## Permisos

Hay dos ejes independientes, más indicadores sueltos, guardados en `usuarios_perfil`:

- **Directorio:** `user`, `admin` o `disabled`.
- **Depósito de mantenimiento** (`mantenimiento_rol`): sin acceso, `comun` o `admin`.
- **Dueño** (`es_owner`): puede crear usuarios y administrar todo. Puede haber varios; se agregan y quitan desde Configuración → Usuarios, y siempre queda al menos uno.
- Indicadores adicionales: ver todos los retiros, ver errores, resetear contraseñas, ver sugerencias.

Las reglas se aplican en la base (políticas RLS), no solo en la interfaz. Las funciones que se usan para chequear permisos en pantalla están en `src/lib/types.ts`.

## Base de datos

Los cambios se aplican con la CLI de Supabase:

```bash
pnpm dlx supabase link --project-ref <ref-del-proyecto>
pnpm dlx supabase db push --dry-run   # muestra qué se aplicaría, sin tocar nada
pnpm dlx supabase db push
```

Las Edge Functions necesitan el secreto `PROJECT_SECRET_KEY` (la "Secret key" del proyecto) configurado en Supabase. Para publicarlas:

```bash
pnpm dlx supabase functions deploy create-user
pnpm dlx supabase functions deploy delete-user
pnpm dlx supabase functions deploy reset-password
```

## Errores

Los errores de la app se guardan en la tabla `error_logs` y se ven en Configuración → Errores (para usuarios con ese permiso). Además se envían a Sentry si está configurado, y una pantalla que se rompe muestra un cartel con la opción de recargar en vez de quedar en blanco.
