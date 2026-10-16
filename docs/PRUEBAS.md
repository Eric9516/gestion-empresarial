# Pruebas: qué hay, qué cubre y qué no

Todo se corre desde la carpeta del proyecto. Lo que está **sin probar** figura al final: léelo antes de entregar a un cliente real.

## 1. Mapa de pruebas

| Comando | Qué prueba | Resultado hoy |
|---|---|---|
| `pnpm test` | Lógica de la app: módulos y licencia, numeración, ajustes, fechas, marca, errores, lectura y escritura de Excel, que ninguna pantalla use emojis como ícono, y la velocidad de la búsqueda con 5.000, 20.000 y 50.000 repuestos | 124 |
| `pnpm lint` · `npx tsc -b` · `pnpm build` · `pnpm audit` | Código sin errores; tipos; la app compila; ninguna dependencia con fallas conocidas | sin errores |
| `pnpm pruebas:esquema` | La base de datos desde cero (en memoria): cadena original y cadena por componentes, que den **el mismo esquema**, que cada plan instale solo lo suyo, ampliar sin perder datos y el camino de **Cremac** (base vieja con datos + migraciones nuevas) | todo bien |
| `pnpm pruebas:pantalla` | **La app en un navegador de verdad** (Playwright con el Microsoft Edge instalado), contra el Supabase local: entrar (clave mal, sin sesión, ya adentro), Directorio (buscar, filtrar, agregar/cambiar/quitar contactos de un proveedor, comisionistas), Depósito (buscar por código, retirar con sector, que el stock baje y devolverlo desde el historial) y Reparaciones (recibir una entrega con remito), en computadora y en celular. También **revisa la accesibilidad de cada pantalla y pestaña con axe** (WCAG 2.1 AA: contraste, nombres de botones y campos, títulos, zonas) y que al abrir una pantalla no se repita ningún pedido al servidor ni falten las tipografías. Arranca y corta solo el servidor y la app; tarda unos dos minutos. Archivos en `e2e/`. Corre también en GitHub | 30 |
| `pnpm pruebas:supabase-local` | Las siete de abajo, contra el **Supabase local** (ver apartado 2). Tarda unos 15 minutos | todo bien |
| ↳ `integracion-local.mjs` | La prueba de integración **real** (`scripts/pruebas/integracion.mjs`): usuarios, dueños, stock, historial, funciones de usuarios, módulos, interruptor del dueño, ajustes, acceso sin sesión, bloqueados, zona horaria | 184 |
| ↳ `instalador-local.mjs` | El instalador **real** `pnpm cliente` de punta a punta: cliente solo-Tareas, ampliarlo a Abastecimiento y a Mantenimiento, activar módulos, adoptar una base que ya existía, y todo lo que se niega a hacer | 41 |
| ↳ `matriz-modulos.mjs` | Las 64 combinaciones de módulos más las claves ausentes, la licencia vacía y el interruptor del dueño: tablas, funciones y carpetas de archivos contra lo que dicen las reglas | 3.220 en 71 combinaciones |
| ↳ `logica.mjs` | Stock, retiros, reposición, fotos, reparaciones, tareas, reglas del dueño, funciones del servidor, historial, apagado de módulos, sin sesión, bloqueados | 116 |
| ↳ `matriz-permisos.mjs` | **Cada configuración posible de usuario** (272) contra 120 operaciones: tablas, funciones, archivos | 32.640 |
| ↳ `cruce-planes.mjs` | **Todos los planes × todos los tipos de usuario**: 16 estados de licencia (Plan 1, Plan 2, cada módulo apagado por la licencia o por el dueño, solo Tareas, ninguno) × 33 usuarios representativos × 120 operaciones. Una operación solo se permite si el usuario tiene el permiso **y** los módulos que toca están activos | 63.360 |
| ↳ `matriz-horarios.mjs` | **Todo lo que depende de la hora** (ver apartado 4): fecha local en 23 zonas horarias × 864 instantes; tareas a cada hora local de 6 zonas con 7 tipos de usuario; vencimiento de acceso (10 estados × 7 usuarios) y su cruce en el segundo exacto; regla de 24 horas de los retiros | 12.581 |
| `pnpm pruebas:integracion --cliente … --es-un-proyecto-de-pruebas` | La misma prueba de integración, pero contra un **proyecto real de Supabase de pruebas** | 185 (probado, ver apartado 3) |
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

## 3. Contra un Supabase real de pruebas (2026-10-11)

Las mismas baterías corren contra un proyecto real de Supabase **de pruebas** (nunca uno con datos reales: se niegan a correr si hay usuarios que no son de prueba). Se instaló un cliente Plan 2 con el instalador real y se corrió:

| Batería | Resultado en Supabase real |
|---|---|
| Instalación `pnpm cliente nuevo --modulos todos` (25 migraciones, 3 funciones, dueño, módulos) y `actualizar` con una migración nueva | bien |
| Integración (`pnpm pruebas:integracion`) | 185 de 185 |
| Permisos: 272 configuraciones de usuario × 120 operaciones | 32.640, 0 diferencias |
| Módulos: 71 combinaciones | 3.220, 0 diferencias |
| Lógica de negocio | 116 de 116 |
| **Todos los planes × todos los usuarios** (16 estados de licencia × 33 usuarios × 120 operaciones) | 63.360, 0 diferencias |
| Horarios: fecha local, tareas por hora, vencimiento de acceso, retiros de 24 h | 12.581, 0 diferencias (más 1 aviso de datos de zonas horarias) |

Cómo se corre (en la carpeta de la plantilla; la llave de Supabase va en una variable de entorno, **no se pega en chats ni en archivos**):

```bash
PROYECTO_REAL=clientes/<cliente>.env.local SUPABASE_ACCESS_TOKEN=sbp_... node scripts/pruebas/supabase-local/matriz-permisos.mjs
# lo mismo con logica.mjs, matriz-modulos.mjs, matriz-horarios.mjs; el cruce de planes:
PROYECTO_REAL=... SUPABASE_ACCESS_TOKEN=... CRUZAR_MODULOS=1 SOLO_CRUZAR=1 node scripts/pruebas/supabase-local/matriz-permisos.mjs
```

**Plan 1 real y ampliación (2026-10-11):** se instaló un cliente real **Plan 1** (Base + Abastecimiento, 21 migraciones; sin tablas, funciones ni carpetas de Mantenimiento) y se corrieron contra él los permisos (32.640) y el cruce de planes × usuarios (63.360) y los horarios (12.581): sin diferencias. Después se lo **amplió a Plan 2 con el comando real** (`pnpm cliente componente --agregar mantenimiento` y `modulos --activar mantenimiento`) y su esquema quedó **idéntico, pieza por pieza (769), al de un Plan 2 instalado de una vez** (`foto-real.mjs`). Sobre ese cliente ampliado se repitió toda la batería: integración 185, módulos 3.220 y lógica 116 sin diferencias; en permisos y horarios aparecieron fallos aislados (15 y 4) que se explicaron y se repitieron limpios (ver abajo).

**Cuidados al probar contra un proyecto real del plan gratuito (aprendidos el 2026-10-11):**
* **El presupuesto de disco se agota.** Cientos de miles de pedidos seguidos hacen que Supabase avise ("agotando su presupuesto de E/S de disco") y las respuestas se vuelven lentas: eso produce **fallos falsos** (se vieron 10 en "editar datos de la empresa" y 5 en equipos, que repetidos con menos carga dieron 0). Conviene partir las baterías enormes, usar 4 trabajadores en vez de 8 y dejar descansar el proyecto.
* **El reloj de la computadora puede estar desfasado** (acá 12 segundos): las pruebas que dependen de la hora fijan y miden los vencimientos con el reloj de la base, no el de la PC.
* **Una corrida interrumpida deja datos de prueba** (`ZZ-…`): la matriz los borra sola al empezar (`limpieza-zz.sql`).
* Cada diferencia imprime ahora el código de la última respuesta, para distinguir un rechazo real de un fallo de red.

Probar contra el servicio real encontró cosas que el simulador no mostraba: el registro de migraciones con permisos abiertos y la ventana de 24 horas de los retiros (ver [PENDIENTES.md](PENDIENTES.md)).

## 4. Los horarios (`matriz-horarios.mjs`)

En el sistema el tiempo importa en tres lugares (se buscó en todo el SQL): **(1)** la fecha "de hoy" de la empresa según su zona horaria (`hoy_local()`: crear, reprogramar y arrastrar tareas, días pendientes, semáforo);
**(2)** el vencimiento del acceso de un usuario (`access_status` y `access_expires_at`); **(3)** la regla de 24 horas para corregir o borrar retiros propios. No existe un "horario de permisos" por franjas.

* **H1** · `fecha_local()` y `hoy_local()` contra `Intl` de Node, en las 11 zonas que ofrece la app (obligatorias) y 12 más de casos raros (offsets de 30 y 45 minutos, +14, hemisferio sur), en 864 instantes (cambios de horario de verano, año nuevo, año bisiesto).
* **H2** · tareas a cada hora local del día y a cada lado de la medianoche, en 6 zonas, con 7 tipos de usuario: crear (hoy, ayer, mañana), reprogramar, arrastrar pendientes y las 28 combinaciones de días × arrastres del semáforo. La hora se inyecta cambiando **solo** el origen de "ahora" dentro de `hoy_local()`; al terminar se restablece.
* **H3** · vencimiento de acceso: 10 estados (activo, prueba, expirado, bloqueado, con fecha pasada o futura) × 7 usuarios × operaciones de tareas y de control, el caso del administrador sobre las tareas de otro cuyo acceso venció, y el cruce **en vivo** del vencimiento.
* **H4** · retiros: 5 edades (1 h, 12 h, 23 h 59 min 30 s, 24 h 0 min 30 s, 48 h) × 7 usuarios × editar, devolver parcialmente, agregar línea, leer y borrar. La edad se fija con el reloj de la base, no el de la computadora.

Se rompió a propósito para comprobar que detecta: usar siempre hora UTC (1.024 diferencias), ignorar el vencimiento (90) e ignorar el estado "expirado/bloqueado" (129); con `MUTAR=utc|sinvencimiento|sinestado` (solo en el simulador local).

## 5. Qué NO está probado todavía

* **El camino real de Plan 1 y de ampliar a Plan 2.** El proyecto real de pruebas es Plan 2; Plan 1 y la ampliación de Abastecimiento a Mantenimiento se probaron en el simulador y con PostgreSQL real embebido, no en un proyecto de Supabase.
* **La app en el navegador contra Supabase real.** Se probó contra el simulador; contra el real falta que alguien inicie sesión (no se escriben contraseñas de servicios reales desde la automatización).
* **El panel con la API de administración real:** se verificó (solo lectura) que la API responde como espera; falta crear un cliente desde el panel mismo.
* **Las llaves de acceso reales** (huella del celular, Windows Hello): se probó con una llave virtual que firma de verdad, pero no con un dispositivo.
* **El panel instalado en un servidor** y detrás de Tailscale; los avisos al celular (ntfy).
* **Publicar la app** (Netlify) y los correos de Supabase.
* **El pase de Cremac** sobre su base real (se probó el camino sobre una base armada igual, con datos).
* **Rendimiento** con muchos datos (la lista de repuestos se estimó, no se midió con 50.000).
* **Pantallas sin prueba de pantalla todavía:** Rótulos, Tareas, Ajustes de stock, Informe de reposición, Familias, importaciones de Excel y la configuración del dueño.

## 6. Cuando se agrega algo

* **Un módulo o una tabla nueva:** sumarlo a `scripts/pruebas/esquema/componentes.mjs` y a los mapas de tablas de `matriz-modulos.mjs` y de `scripts/pruebas/integracion.mjs`; las baterías de permisos (`matriz-permisos.mjs`) se amplían con sus operaciones. Ver [NUEVO-MODULO.md](NUEVO-MODULO.md).
* **Una migración:** correr `pnpm pruebas:esquema` y `pnpm pruebas:supabase-local`.
* Todo corre solo en cada cambio subido a GitHub (ver `.github/workflows/ci.yml`).
