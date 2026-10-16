# Escala: pensado para crecer

**Premisa del producto:** la app se diseña para muchísimos usuarios, muchos GB y muchos clientes, aunque hoy sea chica. Lo que es caro de cambiar después se decide hoy pensando en grande;
lo que se puede encender más adelante se deja listo y se enciende cuando los números lo piden, con una prueba que avise.

## Metas de trabajo (se pueden corregir)

| | Meta |
|---|---|
| Por cliente | 1.000 usuarios · 1.000.000 de repuestos · 50 millones de movimientos · 1 TB de archivos |
| Plataforma | 500 clientes administrados desde el panel |
| Velocidad | cada pantalla responde en menos de 1 segundo; las búsquedas, en menos de 200 ms |
| Copias de seguridad | nunca perjudican la fluidez de quien trabaja |

Referencia real: el sistema que usa Sobrero y Cagnolo en toda la fábrica (todas las áreas, instalado en un servidor propio) ocupa menos de 20 GB.

## La prueba de escala

`pnpm pruebas:escala` llena una base PostgreSQL real en memoria con datos sintéticos (por defecto 50.000 repuestos, 50.000 retiros con 200.000 líneas y 100.000 registros de auditoría;
con `node scripts/pruebas/escala/escala.mjs --items 100000 --retiros 100000 --auditoria 200000` se prueba con más) y mide **las consultas que hace la app, con las reglas de seguridad puestas**,
como las ve una persona real. Marca las que leen una tabla grande entera, las que pasan del presupuesto de tiempo y las **claves foráneas sin índice**. Corre en cada cambio (GitHub Actions)
y falla si una consulta nueva no escala.

Los tiempos de esta base (PostgreSQL compilado a WebAssembly) son más lentos que los de un PostgreSQL de verdad: sirven para comparar y para detectar consultas sin índice, que es lo que se rompe al crecer.

## Qué se encontró (2026-10-16) y cómo se arregló

Medido con 100.000 repuestos, 100.000 retiros (400.000 líneas) y 200.000 registros de auditoría:

| Consulta de la app | Antes | Después |
|---|---|---|
| Historial de retiros, últimos 30 días con sus líneas | **98.746 ms** | 184 ms |
| Proveedores con sus contactos | 6.767 ms | 100 ms |
| Auditoría: últimos 200 | 1.864 ms | 0,6 ms |
| Retiros de un día | 577 ms | 12 ms |
| Repuestos: primera tanda de 1.000 | 24 ms | 10 ms |
| Repuestos: la tanda 100 de 100 (por offset) | 1.357 ms | 219 ms |

Causas y arreglos:

1. **35 claves foráneas sin índice** (Postgres no los crea solo): cada unión y cada borrado recorría la tabla entera. El historial de retiros era el caso extremo (cada retiro buscaba sus líneas leyendo todas).
   → migración `…001400_indices_para_crecer.sql` en cada componente (con los índices de las consultas más usadas: historial por fecha y por persona, repuestos por código y por subfamilia, auditoría por registro).
2. **Reglas de seguridad que llaman a una función "a secas"** (`modulo_activo('deposito')`, `is_owner()`, `auth.uid()`...): se evaluaban una vez por fila. Envueltas en `(select ...)` se calculan una vez por consulta; es la misma regla.
   → migración `…001500_reglas_sin_costo_por_fila.sql` en cada componente, generada por `scripts/herramientas/envolver-reglas.mjs` (91 reglas). Quién puede hacer qué no cambia: lo comprueban las matrices de permisos.

## Lo que sigue pendiente (se ve en la prueba como "pendiente del rediseño")

- **Bajar el catálogo entero al abrir la app no escala:** 50.000 repuestos son unos 25 MB; con 500.000 es inviable (buscar en memoria sí es rápido: 55 ms con 50.000, pero hay que bajarlos). Hace falta **sincronizar solo lo que cambió** (por `updated_at`) y guardar el catálogo en el teléfono.
- **Búsqueda en el servidor:** con las reglas de seguridad puestas, PostgreSQL no usa el índice de texto para un `ILIKE` (una condición no marcada como "segura" no puede evaluarse antes que una regla de seguridad). Se resuelve con **una función de búsqueda** que verifica el permiso una vez y consulta con el índice de trigramas.
- **Paginación por clave** (`codigo > último`) en lugar de `offset`, que lee todo lo anterior.
- **Particionar por fecha** las tablas que crecen sin parar (retiros, líneas, auditoría) y archivar lo viejo, cuando se acerquen a decenas de millones de filas.
- **Copias de seguridad:** copia completa periódica para lo chico; copia continua del registro de cambios (WAL) y archivos incrementales para lo grande. Ver el diseño de copias.

## Reglas para todo lo nuevo

1. **Toda clave foránea lleva índice** (la prueba lo exige). Las columnas de "quién lo hizo" (opcionales) llevan índice parcial: `where columna is not null`.
2. **Toda consulta de una pantalla tiene que poder usar un índice** para lo que filtra y lo que ordena.
3. **En las reglas de seguridad, toda llamada a una función de permisos o a `auth.uid()` va envuelta en `(select ...)`.**
4. **Nada de leer una tabla entera para mostrar una lista**: paginar (por clave) o resumir en la base.
5. Una prueba con datos grandes antes de dar por buena una pantalla nueva.
