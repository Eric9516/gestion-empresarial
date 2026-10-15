# Plan del producto — hacia dónde crece la app

Lo marcado con ❓ son decisiones que faltan.

**Dónde estamos:** el **panel** está construido y probado, y la **reorganización en componentes (E1)** está hecha: la base de datos se arma por componentes (Base, Abastecimiento y Mantenimiento), cada cliente recibe solo lo que contrata, la licencia tiene dos llaves (la del proveedor y el interruptor del dueño) y Mantenimiento es un módulo propio. Referencia técnica: [COMPONENTES.md](COMPONENTES.md). Lo de las etapas E2 en adelante (Administración, requerimientos, varios depósitos, etc.) **todavía no se construyó**; por eso hoy el **Plan 1 equivale a Base + Abastecimiento** y el **Plan 2 a Base + Abastecimiento + Mantenimiento** (Cremac).

## 1. Principios (para crecer parejo)

1. **Un solo código para todos los clientes.** Nunca una copia por cliente. Lo distinto entre clientes es **configuración** o **el plan contratado**.
2. **Tres planes, y las modificaciones se hacen sobre ellos.** Cada pedido de un cliente se resuelve con configuración, con una opción del plan o, en el caso raro, con una extensión.
3. **Lo que no se contrata, no existe en la base del cliente.** Sus tablas, funciones y reglas no se instalan. No hay nada que "abrir" por la fuerza.
4. **La licencia dice qué plan** tiene el cliente. El panel de administración la gestiona.
5. **Cada paso se construye, se prueba y se entrega antes del siguiente.**
6. **Nada fijo de Cremac**: nombres, formatos y códigos configurables por empresa.

## 2. Los componentes y los tres planes

**Componentes** (cada uno con sus propias tablas):

| Componente | Qué incluye |
|---|---|
| **Base** (siempre) | usuarios, permisos, configuración, historial, **Tareas** |
| **Abastecimiento** | proveedores y contactos, comisionistas, envíos con rótulos, **todos los depósitos** (repuestos, insumos, stock, retiros, ajustes), reparaciones (lo que se manda a reparar afuera), requerimientos |
| **Administración** *(antes "Comercial")* | **todo lo administrativo**: órdenes de compra, recepción, órdenes de pago, y lo que se vaya agregando (facturas, cuentas corrientes, etc.) |
| **Mantenimiento** *(grande)* | equipos con documentación, órdenes de trabajo, mantenimiento programado |
| **Producción** *(a futuro: solo si un cliente la pide)* | ⏸ no se construye por ahora (ver sección 6) |

**Los tres planes que se venden** (cada uno incluye todo lo del anterior):

| | **1. Gestión** | **2. Gestión + Mantenimiento** | **3. Integral** |
|---|---|---|---|
| Base (usuarios, permisos, historial, Tareas) | ✔ | ✔ | ✔ |
| Abastecimiento (proveedores, comisionistas, envíos, depósitos, requerimientos) | ✔ | ✔ | ✔ |
| Administración (órdenes de compra y de pago, y lo administrativo que se agregue) | ✔ | ✔ | ✔ |
| Mantenimiento | — | ✔ | ✔ |
| Producción *(a futuro, bajo pedido)* | — | — | ✔ |

**Para quién:** Plan 1, empresas con stock y compras (comercios, distribuidoras); Plan 2, empresas con maquinaria o instalaciones (plantas, talleres); Plan 3, fábricas.
**Opción aparte:** cantidad de depósitos (si se quiere limitar según el cliente).

* **Cremac queda en el Plan 2** (hoy tiene el depósito de mantenimiento, el directorio y las tareas).
* **El Plan 3 queda como idea a futuro:** no se construye ni se vende hasta que un cliente pida Producción. Hoy se ofrecen el **Plan 1** y el **Plan 2**.
* Mantenimiento y Producción hacen sus pedidos de compra a través de Administración, por eso solo existen en planes que ya incluyen todo lo anterior.
* Los submódulos de Producción y lo que se agregue en Administración **no cambian el plan**: entran en el que corresponda.
* Por dentro las piezas se mantienen **separadas** (cada componente con sus tablas): hoy se venden en esas tres combinaciones y, si mañana hace falta otra, no hay que reescribir nada.

## 3. El recorrido de una compra

```
 Depósito / Mantenimiento / Producción    Administración (Compras)          Abastecimiento            Administración
 ─────────────────────────────────    ───────────────────────────    ────────────────────────   ──────────────────
 REQUERIMIENTO  ─────────────────────► elige proveedor ──► ORDEN DE ──► RECEPCIÓN (remito)   ──► ORDEN DE PAGO
 (qué, cuánto, para qué destino)       (compara/decide)      COMPRA      suma al stock           (contra factura)
```

* El requerimiento siempre tiene a dónde ir (Compras): los tres planes incluyen Administración.
* Cada documento tiene **tipo, número propio (con punto de venta), estado, destino y autor**, y queda **relacionado** con los demás (REQ → OC → ingreso → pago). Botones: ver, editar (mientras no esté cerrado), clonar, anular.
* Pantalla de consulta como la de SAE: lista filtrable por tipo, fecha, proveedor, destino y estado.
* ❓ Estados de un requerimiento: borrador → emitido → en compra → recibido (parcial/total) → cerrado/anulado.

## 4. Varios depósitos

"Todos los depósitos" están dentro de **Abastecimiento**. Hoy cada repuesto tiene **un solo stock**; con varios depósitos:

* Existen **depósitos** (Mantenimiento, Insumos, Producción, …) y cada repuesto tiene **un stock por depósito**.
* Hay **transferencias** entre depósitos y permisos **por depósito**.
* Retiros, ajustes y requerimientos indican **de qué depósito**.
* **Cuidado:** cambia el modelo de stock. Se diseña aparte y se prueba con una copia de los datos de Cremac.
* ❓ ¿Los depósitos extra quedan incluidos sin límite, o querés poder limitar la cantidad según el cliente?

## 5. Mantenimiento

Sectores → equipos → documentos (manuales y despieces; el servidor de archivos ya está listo), órdenes de trabajo (quién, qué equipo, qué repuestos consumió, cuánto tardó, estado), historial por equipo y mantenimiento programado. Los repuestos salen del stock de Abastecimiento. Las reparaciones que se mandan a un taller externo **no son de Mantenimiento: son del Depósito** (usan proveedores y repuestos).

## 6. Producción (a futuro, solo si un cliente la pide)

**Decisión: por ahora no se hace.** Queda como algo a tener en cuenta: el espacio está previsto en la estructura (se instalaría encima de la base del cliente sin tocar nada de lo anterior, ver sección 11) pero no se diseña ni se construye hasta que haya un cliente que la necesite. Cuando llegue ese momento:

* Se hace un núcleo **genérico** (sin nada de Cremac adentro) y se prueba con el caso real de ese cliente.
* Todo lo que varíe entre fábricas queda como configuración.

Todavía no se diseñó. Para armarlo hace falta que me cuentes cómo trabajan en la planta. Temas probables, a confirmar uno por uno:

* **Recetas / fórmulas** (qué insumos lleva cada producto y en qué cantidad).
* **Órdenes de producción** (qué se produce, cuánto, en qué sector, cuándo).
* **Consumo de materias primas** (descuenta del stock) e **ingreso del producto terminado** (suma al stock).
* **Lotes y trazabilidad** (de qué lote de materia prima salió cada lote de producto).
* **Rendimientos, mermas y costos.**
* **Planificación y turnos.**

## 7. Cómo se vende y se protege

* Se vende el **Plan 1, 2 o 3**. Todo queda en la licencia.
* **Qué se puede vender y cuándo:** el Plan 1 al terminar la etapa de Administración (E4); el Plan 2 al terminar Mantenimiento (E6); el Plan 3 solo si algún día se construye Producción (E7, bajo pedido). Mientras tanto, lo que ya existe sirve para un primer cliente chico.
* Al dar de alta o ampliar un cliente, el panel instala **solo** lo que contrató.
* La web que se publica para cada cliente trae solo las pantallas de lo contratado.
* Cada cliente tiene su cuenta de Supabase (plan Pro, a su cargo).
* Lo que no se pueda impedir técnicamente lo cubre el contrato.
* **Modificaciones a pedido:** primero configuración; luego opciones propias del plan; recién al final extensiones en un repositorio aparte.

## 8. Hoja de ruta por etapas

| Etapa | Qué se hace | Está lista cuando… |
|---|---|---|
| **E0** ⏳ | Terminar y probar el **panel** (agregar organización, datos para publicar, prueba real con otra cuenta de Supabase) | se da de alta un cliente de punta a punta. **Hecho y probado con un Supabase simulado; falta instalarlo en el servidor y la prueba real** |
| **E1** ✅ | **Reorganizar lo existente en componentes** (y que el dueño pueda apagar módulos de su plan, sección 12): Tareas a la Base; proveedores + comisionistas + envíos + depósitos juntos en Abastecimiento; los equipos a Mantenimiento (los sectores y las reparaciones quedaron con el Depósito, en Abastecimiento). La instalación crea **solo lo del plan contratado** | un cliente de prueba "Plan 1" no tiene ni una tabla de Mantenimiento ni de Producción; Cremac queda idéntico. **Hecho** (la parte de Administración y Producción no existe todavía). Falta correr el instalador y la pantalla del dueño contra un Supabase real |
| **E2** | **Configurable por empresa**: nombres, formato del código de repuesto, formatos regionales | otra empresa usa sus propios nombres y códigos |
| **E3** | **Requerimientos** + pantalla de consulta | un depósito emite un requerimiento y Compras lo ve |
| **E4** | **Administración**: órdenes de compra, recepción, órdenes de pago | un requerimiento llega hasta una orden de pago |
| **E5** | **Varios depósitos** con transferencias | dos depósitos con stock propio |
| **E6** | **Mantenimiento** completo: órdenes de trabajo, equipos con documentación, mantenimiento programado | una orden de trabajo consume repuestos |
| **E7** | ⏸ **Producción — solo si un cliente lo pide**: primero relevar, después construir de a un submódulo | una orden de producción consume materia prima y suma producto terminado |
| **E8** | Pulido de diseño de todas las pantallas, backups, documentación para clientes | se entrega a un cliente nuevo sin ayuda tuya |

El diseño visual se pule **a medida que se construye cada etapa** y se hace una pasada general en E8.

## 9. Decisiones abiertas

Resueltas: ✅ tres planes (Gestión, Gestión + Mantenimiento, Integral), ✅ "Comercial" pasa a llamarse Administración y reúne todo lo administrativo, ✅ requerimientos dentro de Abastecimiento, ✅ Producción entra solo en el Plan 3 con todos sus submódulos.

1. ❓ **Nombres comerciales finales** de los tres planes y de "Administración" (y los precios, cuando haya clientes reales).
2. ❓ **Quién aprueba un requerimiento** antes de comprar: ¿un jefe, o pasa directo a Compras?
3. ❓ **Numeración de documentos:** ¿punto de venta + número correlativo como SAE (REQ 0028-00001938)? ¿Cada cliente configura el suyo?
4. ❓ **Cotizaciones:** ¿Compras elige un proveedor a mano, o se cargan varias cotizaciones y se elige la mejor?
5. ❓ **Facturas de proveedores:** ¿la orden de pago se hace contra una factura cargada, o alcanza con el pago?
6. ❓ **Roles y permisos por depósito** (pedir, aprobar, comprar, recibir, pagar).
7. ❓ **Límite de depósitos por cliente** (ver sección 4).
8. ⏸ **Alcance de Producción:** en espera hasta que un cliente lo pida (sección 6).
9. ✅ **Orden de las etapas:** E1 se hizo primero.

## 10. Riesgos

* **E5 toca la estructura de datos** (E1 ya se hizo, con la prueba de equivalencia): es la etapa delicada. Se hacen sobre una copia de los datos de Cremac, con las baterías de prueba que ya existen (instalación desde cero, permisos, módulos prendidos/apagados).
* **Administración y Mantenimiento son grandes y todavía no están definidos:** el riesgo es construir antes de entender. Por eso se releva primero. Producción no se construye hasta que alguien la pida.
* **Querer todo a la vez:** por eso va por etapas y cada una termina con algo probado.

## 11. Reglas para crecer sin romper nada

**Dónde va cada cosa nueva.** Cada componente tiene sus propias tablas, y lo nuevo va donde corresponde según para qué sirve:

| Si lo nuevo es… | Va en… |
|---|---|
| administrativo o de dinero (cheques, cuentas corrientes, facturas) | Administración |
| proveedores, comisionistas, envíos, stock, depósitos, requerimientos | Abastecimiento |
| máquinas, equipos, órdenes de trabajo | Mantenimiento |
| fabricar productos (recetas, lotes, mermas) | Producción |
| usuarios, permisos, configuración, tareas | Base |

Una ampliación (por ejemplo, gestión de cheques) es una **ampliación de su componente**, no un módulo suelto: llega, con "Actualizar", solo a los clientes que tienen ese componente.

**Agregar un componente a un cliente que ya existe** (por ejemplo, Producción más adelante):

1. Se instalan **solo las migraciones de ese componente**, encima de la base que ya tiene. Se crean tablas nuevas y se conectan con las existentes.
2. **No se modifica ni se borra ninguna tabla anterior**: no se pierde ningún dato.
3. Las dependencias van en **una sola dirección** (Producción usa el stock; el stock no depende de Producción), así que instalarlo no rompe lo anterior.
4. Después se activa en la licencia. El panel lo hace como una operación firmada ("Instalar componente"; también existe `pnpm cliente componente`). **Ya funciona.**

**Quitar un componente que ya tiene datos no se hace automáticamente:** es un trabajo manual, porque puede haber historia que el cliente quiere conservar.

**Cambios que tocan algo que usan varios componentes** (por ejemplo, pasar el stock a "varios depósitos") se hacen aparte, probados sobre una copia de los datos de Cremac.

**Alcance de los componentes nuevos:** antes de construir Mantenimiento o Producción se escribe una ficha de una página (qué hace, qué no hace, qué datos guarda) con el usuario. Para Producción hace falta relevarlo desde cómo se trabaja en la planta.

## 12. El dueño del cliente puede apagar módulos de su plan

Decisión: dentro de lo que el cliente contrató, el **dueño** puede apagar los módulos que no quiere ver (por ejemplo, Tareas) y volver a prenderlos cuando quiera.

* **Dos interruptores.** La **licencia** (lo contratado) la maneja solo el proveedor desde el panel de administración; las tablas de lo no contratado no existen. La **preferencia del dueño** (qué quiere ver de lo contratado) la maneja el dueño desde su Configuración.
* **Un módulo funciona solo si está contratado y el dueño lo tiene prendido.**
* El dueño solo ve y maneja los módulos **de su plan**. Lo no contratado no se puede prender desde ahí.
* **Apagar no borra nada**: los datos quedan guardados y vuelven al prenderlo.
* No se puede apagar un módulo del que depende otro que sigue prendido (Envíos necesita Proveedores).
* La base (usuarios, permisos, configuración) no se apaga.
* **Hecho en la etapa E1** (*Configuración → General → Módulos*, solo el dueño; ver [COMPONENTES.md](COMPONENTES.md)).

## 13. Cuando un cliente quiere algo que la plantilla no tiene

**Orden de decisión (siempre de arriba hacia abajo):**

1. **Configuración**: ¿se resuelve con una opción de la plantilla (nombres, campos, formatos)? Entonces no se toca código.
2. **Ampliar la plantilla**: si sirve a más clientes, se agrega como opción y llega a todos con "Actualizar".
3. **Repositorio propio del cliente**: solo si es algo muy específico, sin sentido para los demás. Es el último recurso.

**Cómo se arma un repositorio propio** (no es una copia suelta: sigue atado a la plantilla):

* Se crea a partir de la plantilla y se mantiene una conexión para **traerle las mejoras** de la plantilla con regularidad.
* **Todo lo del cliente va en carpetas propias**: pantallas en `src/extensiones/<cliente>/` y migraciones de base de datos en una carpeta aparte, con su propia numeración. Se tocan lo mínimo posible los archivos de la plantilla.
* Los cambios en la base **se agregan**; nunca modifican tablas de la plantilla.
* Si algo del cliente resulta útil para otros, **se pasa a la plantilla** y se saca de su repositorio.

**Cómo se publica y actualiza:**

* Su sitio de Netlify apunta a **su** repositorio.
* Su base recibe las migraciones de la plantilla **más las suyas**.
* El panel de administración solo conoce las migraciones de la plantilla: a estos clientes se los actualiza con el comando, desde su repositorio. (Es un costo extra de tener un cliente especial.)

**Condiciones comerciales:** la personalización **se cobra aparte**, y **su mantenimiento también** (traerle las mejoras de la plantilla y resolver choques). Se decide caso por caso; no debe ser la norma.
