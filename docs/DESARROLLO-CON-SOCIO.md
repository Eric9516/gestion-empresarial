# Trabajar con una persona que desarrolla solo las pantallas

Caso: alguien (por ejemplo, el encargado de mantenimiento de una fábrica, sin conocimientos de programación) diseña **solo las pantallas** de un módulo con su propio Claude. Tiene que ver la app funcionando con datos reales de ejemplo, pero **no** recibe la base de datos, el instalador ni el panel.

## Qué recibe y qué no
* **Recibe:** una carpeta con `src/` (todas las pantallas), la configuración mínima, `LEEME.md` (pasos para él) y `CLAUDE.md` (reglas para su Claude).
* **No recibe:** `supabase/` (migraciones, reglas de seguridad, funciones), `scripts/` (instalador y pruebas), `panel/`, `docs/`, `clientes/`, ninguna llave ni archivo `.env`.
* Ve los **nombres** de tablas y columnas (están en `src/lib/database.types.ts` y en las consultas): es lo que necesita para armar una pantalla.
* Todo lo que se entrega puede copiarse: la protección real es un **acuerdo escrito** sobre de quién es lo que desarrolle (ver [PENDIENTES.md](PENDIENTES.md), "Lo legal y comercial").

## Armar (o rehacer) la copia
```bash
node scripts/exportar-pantallas.mjs --reemplazar --env-desde <archivo con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY>
```
Crea `../gestion-empresarial-pantallas` (afuera del proyecto), genera su `pnpm-lock.yaml`, escanea que no se haya colado ninguna clave y deja `git` iniciado con la rama `main`.
Con `--env-desde` la copia lleva su propio `.env` **dentro del repositorio** (solo la dirección y la clave **pública**; el script comprueba que la clave sea de rol `anon` y se niega si no lo es), así quien la clona solo necesita `pnpm install` y `pnpm run dev`.
Por eso **el repositorio tiene que ser privado** y el registro público de usuarios de la base de pruebas tiene que estar apagado. Sin `--env-desde`, el `.env` queda fuera de Git.
(`--arranque-automatico` hace que `pnpm install` además deje la app corriendo; por defecto no.) Es una **copia de un momento**: si `src/` cambia en el proyecto principal, hay que rehacerla o llevarle los cambios a mano (los textos que la acompañan están en `scripts/plantillas-pantallas/`).

## Qué instrucciones recibe su Claude
Se editan en `scripts/plantillas-pantallas/` y se copian al repo de la copia (no hace falta rehacerla entera: se copian los archivos y se sube un commit):
* `CLAUDE.md`: la **regla de oro** (no escribir, editar ni borrar nada sin un "sí" claro; una pregunta por vez; no programar hasta terminar la entrevista y aprobar la propuesta) y las normas cortas.
* `MODULO-MANTENIMIENTO.md`: el producto (genérico, para plantas de proceso; primero alimentos/lácteos), el punto de partida acordado (sector → subsector opcional → equipo; manuales, repuestos, historial, QR; órdenes de trabajo con cronómetro y colaboradores; rutinas preventivas que generan OT), lo que está abierto y el método: paso 0 mirar las carpetas existentes (solo lectura), 1 entrevista, 2 propuesta sin programar, 3 aprobación, 4 construcción.
* `.claude/settings.json`: arranca en **modo plan** (no puede editar archivos hasta que se apruebe el plan). Es el freno técnico; las instrucciones solas pueden fallar.
* `.gitignore` ignora `datos-reales/`: las carpetas reales de la empresa (manuales, planillas) **no** deben entrar al repositorio.

## Qué datos ve
La app de su computadora necesita un archivo `.env` con **solo dos datos**: la dirección y la clave pública de un proyecto de Supabase **de copia o de pruebas** (nunca el de producción), y un usuario propio creado en ese proyecto (en una copia de pruebas puede ser dueño; en producción, nunca). La clave de servicio y las llaves `sbp_…` no salen del equipo del dueño del producto.

## Traer lo que hizo al proyecto principal
Él sube su trabajo a un repositorio **privado** de GitHub (`Eric9516/gestion-empresarial-pantallas`, una sola rama `main`, sin ramas intermedias). Desde el proyecto principal:
```bash
git remote add pantallas https://github.com/Eric9516/gestion-empresarial-pantallas.git
git fetch pantallas
git switch -c mantenimiento-ui-importado
git checkout pantallas/main -- src/features/mantenimiento src/pages/MantenimientoPage.tsx
```
La pantalla del módulo es `src/pages/MantenimientoPage.tsx` (nueva; el Depósito es `DepositoPage.tsx` desde el 2026-10-17). Si enganchó la ruta `/mantenimiento` en `src/App.tsx` (que hasta entonces redirige al Depósito) y el menú de áreas, esos cambios se traen a mano.
Se revisa con `git diff`, se corren `pnpm test`, `pnpm lint` y `pnpm build`, y se lee `NOTAS-PARA-ERIC.md` de la carpeta (dice qué datos necesita cada pantalla). Después se arma la parte de base de datos como migración nueva en `supabase/componentes/mantenimiento/` (ver [NUEVO-MODULO.md](NUEVO-MODULO.md)) y se reemplazan los datos de ejemplo por consultas reales.
