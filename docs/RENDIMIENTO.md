# Rendimiento: un pilar del producto

La rapidez y la fluidez con muchísimos datos y muchas personas trabajando a la vez no son un detalle: son una de las razones por las que este software existe. Este documento dice qué se exige,
qué se midió, qué se encontró, qué ya se corrigió y qué falta. Se complementa con [ESCALA.md](ESCALA.md) (metas y reglas) y [PRUEBAS.md](PRUEBAS.md) (qué prueba qué).

## Lo que se exige

| | Meta |
|---|---|
| Datos por cliente | 10 depósitos × 20.000 artículos (≈200.000 líneas de stock; catálogo de 200.000 a 500.000), 50 millones de movimientos, 1 TB de archivos |
| Personas a la vez | cientos por cliente, buscando, editando, retirando, borrando y guardando al mismo tiempo |
| Respuesta | cada pantalla en menos de 1 segundo; una búsqueda en menos de 200 ms (percentil 95) |
| Integridad | jamás se pierde ni se inventa una unidad de stock, jamás un retiro queda a medias, jamás dos personas reciben el mismo código |
| Copias de seguridad | nunca perjudican a quien está trabajando |

## Cómo se mide (todo corre solo en cada cambio)

| Prueba | Qué hace | Comando |
|---|---|---|
| Escala de la base | Datos sintéticos grandes y las consultas de la app **con las reglas de seguridad puestas**; marca lecturas de tabla entera, consultas lentas y claves foráneas sin índice | `pnpm pruebas:escala` |
| **Carga y concurrencia con una PostgreSQL real** | Decenas de personas a la vez (buscan, listan, ven el historial, editan, retiran, ajustan, crean y borran) durante un rato; mide mediana, p95, p99 y peor caso de cada operación y comprueba lo que nunca puede fallar | `pnpm pruebas:concurrencia` |
| Búsqueda con 200.000 repuestos | Cuánto tarda cada tipo de búsqueda y si devuelve lo correcto | `node scripts/pruebas/concurrencia/busqueda.mjs` |
| Navegador con catálogos enormes | Tiempo hasta poder usar la lista, memoria y trabas con 5.000, 50.000 y 200.000 repuestos | `ESCALA=1 pnpm exec playwright test e2e/escala-cliente.spec.ts` |
| Búsqueda en memoria | La búsqueda local con 5.000, 20.000 y 50.000 repuestos | `pnpm test` (`busqueda.bench.test.ts`) |
| Arranque | Que al abrir una pantalla no se repita ningún pedido | `pnpm pruebas:pantalla` |

La prueba de concurrencia usa una **PostgreSQL 18 real** que se instala como paquete de npm (no hace falta Docker ni instalar nada en Windows) y funciona igual en GitHub.
Cada operación se ejecuta como la ve la app: una transacción con el rol y el usuario de quien la hace. Con `--viejo` repite el comportamiento de antes de las correcciones, para comprobar que la prueba detecta los problemas.

## Lo que se encontró y se corrigió (2026-10-16)

### Velocidad de la base (100.000 repuestos y retiros, 400.000 líneas)

| Consulta | Antes | Después |
|---|---|---|
| Historial de retiros, últimos 30 días | **98,7 s** | 0,18 s |
| Proveedores con sus contactos | 6,8 s | 0,10 s |
| Auditoría: últimos 200 | 1,9 s | 0,6 ms |
| Búsqueda de texto con 200.000 repuestos (sin competencia) | 85–150 ms, leyendo toda la tabla | 2–11 ms usando el índice |

Causas: 35 claves foráneas sin índice; reglas de seguridad que llamaban funciones fila por fila (91 reglas, ahora una vez por consulta); y una limitación de PostgreSQL: con reglas de seguridad por fila,
una búsqueda `ILIKE` directa sobre la tabla **no puede usar el índice de texto**, así que hay una función (`buscar_repuestos`) que verifica el permiso una vez y busca con el índice.

### Datos que se podían perder (carga con comportamiento anterior vs. actual)

| Situación | Antes | Ahora |
|---|---|---|
| Dos personas editan el mismo repuesto y la segunda guarda un stock viejo | 23 de 200 repuestos con el stock equivocado en 10 s (20 personas) | 0: el guardado dice sobre qué versión se hizo; si alguien lo cambió, avisa y no pisa |
| Retiros simultáneos con los mismos repuestos (10 repuestos, 60 personas) | 37 bloqueos mutuos, 36 retiros vacíos, stock equivocado en los 10, 22 operaciones por segundo | 0, 0, stock exacto, 333 operaciones por segundo |
| Un retiro que fallaba a mitad de camino | quedaba un retiro vacío | todo o nada (`confirmar_retiro`, líneas siempre en el mismo orden) |
| Dos altas simultáneas de repuesto en la misma subfamilia | el mismo número: falla una | la base asigna números distintos (`crear_repuesto`) |

### Con 200.000 repuestos, 300.000 retiros (1,2 millones de líneas), 500.000 de auditoría y 60 personas trabajando sin pausa

(Es una prueba de saturación: cada persona hace unas 2 operaciones por segundo; en la realidad hace una cada varios segundos.)

| | Búsqueda directa (antes) | Función `buscar_repuestos` (ahora) |
|---|---|---|
| Operaciones por segundo que sostiene el sistema | 63 | **110** |
| Búsqueda, mediana | 1.897 ms | 200 ms |
| Integridad (stock exacto, sin retiros vacíos, sin bloqueos, sin códigos repetidos) | se cumple | se cumple |

Lo que más tarda ahora son las listas que traen todo sin paginar: el historial de retiros (1,5 s) y los proveedores con contactos (1,3 s).

## Lo que falta (en orden de prioridad)

1. **Paginar y filtrar en la base** todas las pantallas que hoy traen todo: historial de retiros, proveedores, ajustes, tareas, papelera, auditoría, errores, sugerencias, historial por repuesto,
   informe de reposición. Algunas además **cortan en un número fijo** y lo que queda más atrás es inalcanzable (auditoría y errores: 200; envíos: 300; numeración: 5.000 por subfamilia).
2. **Catálogo sin bajarlo entero:** usar `buscar_repuestos` y listas por clave en las pantallas de repuestos (hoy el catálogo se baja completo: ≈25 MB con 50.000, inviable con 200.000), más
   sincronizar solo lo que cambió y guardarlo en el teléfono (modo sin conexión).
3. **Varios depósitos:** stock por (repuesto, depósito), índices con el depósito como primera columna, informes por depósito.
4. **Particionar por fecha** las tablas que crecen sin parar (retiros, líneas, auditoría) y archivar lo viejo.
5. **Avisos en vivo** (Realtime) para que las pantallas se actualicen cuando otra persona cambia algo, y control de versión también en reparaciones y envíos.
6. **Importaciones grandes** (stock, familias) en una sola operación en la base, sin miles de pedidos, y la lectura de Excel fuera del hilo principal.
7. **Exportaciones grandes** (Excel/PDF) hechas en el servidor.
8. **Pruebas de capacidad contra el proyecto real de Supabase** (conexiones, tamaño de máquina) antes de entregar a un cliente grande.
9. **Presupuestos de velocidad en CI** que hagan fallar un cambio que empeore los tiempos.

## Reglas para todo lo nuevo

1. Toda clave foránea lleva índice; toda consulta de una pantalla usa un índice para lo que filtra y ordena.
2. En las reglas de seguridad, toda llamada a una función de permisos o a `auth.uid()` va envuelta en `(select ...)`.
3. Una búsqueda por texto no se hace directamente sobre una tabla con reglas de seguridad: se hace con una función que verifica el permiso una vez.
4. Ninguna pantalla trae "todo": pagina por clave y el filtro lo hace la base.
5. **El stock cambia solo por retiros, recepciones y ajustes**, nunca porque alguien guarde un formulario con un número viejo. Toda edición de un registro compartido dice sobre qué versión se hizo.
6. Una operación que toca varias líneas (retiro, ajuste, recepción) es una sola operación en la base, y recorre las líneas siempre en el mismo orden.
7. Antes de dar por buena una pantalla o una operación nueva: probarla con datos grandes y con muchas personas a la vez.

## Decisiones pendientes del dueño del producto

- **Stock negativo:** hoy un retiro puede dejar el stock en negativo (la base solo lo impide en los ajustes), porque un retiro registra algo que ya pasó físicamente. ¿Se mantiene así o se rechaza?
