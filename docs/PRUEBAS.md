# Pruebas: qué hay, qué cubre y qué no

Todo se corre desde la carpeta del proyecto. Lo que está **sin probar** figura al final: léelo antes de entregar a un cliente real.

## 1. Mapa de pruebas

| Comando | Qué prueba | Resultado hoy |
|---|---|---|
| `pnpm test` | Lógica de la app: módulos y licencia, numeración, ajustes, fechas, marca, errores, lectura y escritura de Excel, y que ninguna pantalla use emojis como ícono | 98 |
| `pnpm lint` · `npx tsc -b` · `pnpm build` · `pnpm audit` | Código sin errores; tipos; la app compila; ninguna dependencia con fallas conocidas | sin errores |
| `pnpm pruebas:esquema` | La base de datos desde cero (en memoria): cadena original y cadena por componentes, que den **el mismo esquema**, que cada plan instale solo lo suyo, ampliar sin perder datos y el camino de **Cremac** (base vieja con datos + migraciones nuevas) | todo bien |
| `pnpm pruebas:supabase-local` | Las cinco de abajo, contra el **Supabase local** (ver apartado 2) | todo bien |
| ↳ `integracion-local.mjs` | La prueba de integración **real** (`scripts/pruebas/integracion.mjs`): usuarios, dueños, stock, historial, funciones de usuarios, módulos, interruptor del dueño, ajustes, acceso sin sesión, bloqueados, zona horaria | 184 |
| ↳ `instalador-local.mjs` | El instalador **real** `pnpm cliente` de punta a punta: cliente solo-Tareas, ampliarlo a Abastecimiento y a Mantenimiento, activar módulos, adoptar una base que ya existía, y todo lo que se niega a hacer | 41 |
| ↳ `matriz-modulos.mjs` | Las 64 combinaciones de módulos más las claves ausentes, la licencia vacía y el interruptor del dueño: tablas, funciones y carpetas de archivos contra lo que dicen las reglas | 3.220 en 71 combinaciones |
| ↳ `logica.mjs` | Stock, retiros, reposición, fotos, reparaciones, tareas, reglas del dueño, funciones del servidor, historial, apagado de módulos, sin sesión, bloqueados | 116 |
| ↳ `matriz-permisos.mjs` | **Cada configuración posible de usuario** (272) contra 120 operaciones: tablas, funciones, archivos | 32.640 |
| `pnpm pruebas:integracion --cliente … --es-un-proyecto-de-pruebas` | La misma prueba de integración, pero contra un **proyecto real de Supabase de pruebas** | pendiente (ver apartado 3) |
| dentro de `panel/`: `pnpm test` · `pnpm run typecheck` · `pnpm audit` · `pnpm build` | El panel: ataques (autenticación, sesiones, CSRF, entradas, concurrencia, fugas), instalación por componentes, base real | 609 |

Además se probó a mano en el navegador (con el Supabase local): la app de tres clientes distintos (solo Tareas, Plan 1, Plan 2) con ingreso real, el interruptor del dueño, la pestaña Reparaciones que aparece y desaparece; y el panel con una llave de acceso virtual: alta, ingreso, instalar un componente con firma, activar un módulo.

**Pruebas de las pruebas:** se rompió el sistema a propósito en seis lugares (el interruptor del dueño que deja de bloquear, una regla de bloqueo de módulo abierta, borrar proveedores sin ser dueño, una regla de seguridad faltante en la cadena por componentes, el instalador que se equivoca con las dependencias de los componentes y la regla que frena a los usuarios bloqueados en los archivos) y **cada vez alguna prueba saltó**. La última detección llevó a reforzar la prueba de integración (un bloqueado que intenta subir a la carpeta de rótulos).

Se verificó una vez, con un PostgreSQL 18 real (no el de memoria), que las pruebas de esquema dan lo mismo.

## 2. El Supabase local (`scripts/pruebas/supabase-local/`)

Un servidor que se comporta como un proyecto de Supabase, para poder probar **todo** sin tocar un proyecto real ni pagar nada:

* **Es real:** la base PostgreSQL (con las migraciones, los permisos, las reglas de seguridad por fila, los disparadores y las funciones), el código de las funciones del servidor (`supabase/functions/*`), la librería `supabase-js` que usa la app, la app misma y el instalador `pnpm cliente`.
* **Está simulado** (escrito para esto, no es el de Supabase): el traductor de pedidos REST a SQL (filtros, relaciones embebidas, altas, cambios, borrados, funciones), el ingreso y la administración de usuarios, la subida y bajada de archivos, el entorno de las funciones y el comando `supabase` (un `npx` falso).
* Atiende varios proyectos a la vez en `http://127.0.0.1:<puerto>/p/<proyecto>/…`.

Para ver la app en el navegador con tres clientes de ejemplo:

```bash
node scripts/pruebas/supabase-local/servidor-ui.mjs        # deja corriendo el servidor y escribe .env.ui-tareas, .env.ui-plan1 y .env.ui-plan2
pnpm exec vite --mode ui-plan2 --port 3013                  # (o ui-plan1 / ui-tareas) → entrar con dueno@plan2.test y la clave que imprime el servidor
```

Los archivos `.env.ui-*` son temporales y no se suben a Git.

## 3. Qué NO está probado todavía

* **Un Supabase de verdad.** El Supabase local imita a PostgREST, a la autenticación, al almacenamiento y al entorno de las funciones (Deno). Las diferencias finas entre la imitación y la plataforma real solo se ven en un proyecto real. Hacen falta, con la segunda cuenta de Supabase de pruebas: `pnpm pruebas:integracion` contra ese proyecto, el instalador (`pnpm cliente nuevo`, `componente`, `modulos`) y el panel con la API de administración real.
* **Las llaves de acceso reales** (huella del celular, Windows Hello): se probó con una llave virtual que firma de verdad, pero no con un dispositivo.
* **El panel instalado en un servidor** y detrás de Tailscale; los avisos al celular (ntfy).
* **Publicar la app** (Netlify) y los correos de Supabase.
* **El pase de Cremac** sobre su base real (se probó el camino sobre una base armada igual, con datos).
* **Rendimiento** con muchos datos.

## 4. Cuando se agrega algo

* **Un módulo o una tabla nueva:** sumarlo a `scripts/pruebas/esquema/componentes.mjs` y a los mapas de tablas de `matriz-modulos.mjs` y de `scripts/pruebas/integracion.mjs`; las baterías de permisos (`matriz-permisos.mjs`) se amplían con sus operaciones. Ver [NUEVO-MODULO.md](NUEVO-MODULO.md).
* **Una migración:** correr `pnpm pruebas:esquema` y `pnpm pruebas:supabase-local`.
* Todo corre solo en cada cambio subido a GitHub (ver `.github/workflows/ci.yml`).
