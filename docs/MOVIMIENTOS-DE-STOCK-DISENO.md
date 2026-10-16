# Movimientos de stock con comprobante — diseño

Estado: **diseño conversado con el dueño del producto (16 de octubre de 2026). Todavía no se construyó.** Faltan los formatos de los comprobantes (orden de compra, remito, orden de pago), que el dueño va a pasar,
y algunas decisiones (ver el final). Se relaciona con [COMPRAS-Y-DEPOSITOS-DISENO.md](COMPRAS-Y-DEPOSITOS-DISENO.md) y con [RENDIMIENTO.md](RENDIMIENTO.md).

## Principio

**El stock solo cambia por un movimiento, y cada movimiento es un documento con su propio número correlativo.** Nunca porque alguien edite un artículo ni guarde un formulario con un número.

## Los movimientos

| Movimiento | Para qué | Comprobante |
|---|---|---|
| **Retiro** | Sale material (ya existe) | Retiro N° … |
| **Carga de stock** | Entra mercadería que no es una corrección ("agarro una caja y la cargo") | Carga N° … |
| **Ajuste positivo** | Corregir hacia arriba (el conteo dio más que el sistema) | Ajuste N° … |
| **Ajuste negativo** | Corregir hacia abajo (rotura, pérdida, conteo) | Ajuste N° … |
| **Recepción de remito** | Entra lo comprado (con el módulo de Compras) | Recepción N° … |
| **Transferencia entre depósitos** (con varios depósitos) | Pasa de un depósito a otro | Transferencia N° … |

Un movimiento puede tener **varios artículos** (una caja con 20 repuestos distintos se carga de una vez). Cada línea guarda cuánto había antes y cuánto quedó después.

## Reglas

1. **El stock nunca queda negativo** (decidido). Lo hace cumplir la base de datos, de forma atómica.
2. **El stock no se edita en la ficha del artículo.** Se muestra el número actual con un botón "Cambiar stock…" que abre el movimiento (carga o ajuste) ya apuntando a ese artículo.
3. **Crear un artículo con stock inicial** registra automáticamente una "carga inicial".
4. **Importar stock desde Excel** es un único movimiento registrado (no miles de cambios sueltos).
5. **La base lo hace cumplir:** ningún camino puede cambiar el stock sin dejar un movimiento (se bloquea el cambio directo del campo; solo lo hacen las funciones de los movimientos).
6. Un movimiento es todo o nada: si una línea falla, no se registra ninguna. Las líneas siempre se recorren en el mismo orden (evita bloqueos entre personas).
7. Se puede **anular** (con motivo y quién): el stock vuelve a como estaba, el número queda en la lista marcado como anulado y **nunca se reutiliza**.

## Numeración (como un remito o una orden de compra)

- **Un contador correlativo por tipo de documento**, y cuando haya varios depósitos, **por depósito** (punto de venta + número), por ejemplo `RET 0003-00000128`.
- **Sin saltos:** el número se toma dentro de la misma operación que crea el documento (contador con candado); si la operación falla, el número no se gasta. (Una secuencia común de PostgreSQL deja huecos.)
- **El historial que ya existe** (retiros y ajustes de Cremac) recibe su número retroactivamente, en orden cronológico.
- Los números se pueden **buscar** y tocar para abrir el documento.

## El comprobante: se guarda como datos, no como PDF

**Lo único que se guarda es el documento como datos** (el encabezado y sus líneas: unos cientos de bytes, la base los comprime sola). **Nunca se guarda un archivo PDF.** El comprobante se dibuja cada vez que se pide, a partir de esos datos:

1. **Vista previa en pantalla (HTML):** una hoja A4 (210 × 297 mm) con el formato de un remito; si no entra en una hoja, sigue en la siguiente con el encabezado repetido.
2. **Imprimir:** la misma hoja con estilos de impresión en A4, sin menús ni botones.
3. **Descargar PDF:** se genera en el momento, en el navegador (texto vectorial, unos pocos KB), a partir de los mismos datos y con el mismo formato A4. No pasa por el servidor ni ocupa lugar guardado.

Por qué: en Cremac hoy un PDF de rótulo guardado pesa unos 190 KB (53 PDFs = 10 MB); un comprobante guardado como dato pesa ~1 KB. Con millones de comprobantes, la diferencia es de decenas de GB contra un par de GB.
Para que reimprimir un documento viejo muestre lo que decía en su momento, el documento guarda un pequeño texto con los datos del emisor de ese día (razón social, CUIT, domicilio: ~150 bytes); las líneas guardan el artículo, la cantidad y el stock antes y después (la descripción se toma del catálogo).

Encabezado de la empresa (logo, CUIT, domicilio), tipo y número, fecha, quién lo hizo, sector o destino, observaciones, las líneas (código, descripción, cantidad, stock antes y después) y firmas.
El formato exacto se define con los ejemplos que pase el dueño (orden de compra, remito, orden de pago).

## La pantalla

La pestaña **Ajustes** pasa a **Movimientos de stock**: una lista de todos los comprobantes (retiros, cargas, ajustes, y más adelante recepciones y transferencias), paginada y filtrable por tipo, fecha, usuario, artículo y número, con los botones **Cargar stock** y **Ajuste**.

## Cambios en lo que ya existe

- `ajustes_inventario` / `ajuste_items` ya tienen cabecera, líneas, motivo, anulación y stock antes/después: se extienden con el tipo (carga o ajuste) y el número.
- `retiros` / `retiro_items` ganan el número.
- Un contador (`numeradores`) y una función `siguiente_numero(tipo, depósito)`.
- Una vista o función única para listar todos los comprobantes juntos, con paginación por clave (ver RENDIMIENTO.md).
- Los triggers que hoy mueven el stock (retiros, reparaciones, ajustes) marcan "este cambio de stock es legítimo"; cualquier otro cambio directo del campo se rechaza.

## Pendientes por decidir

1. **Quién puede cargar stock** (¿el mismo permiso que ajustar, todos los administradores del depósito, o un permiso aparte?) y **quién puede ajustar**.
2. **Los formatos** de orden de compra, remito y orden de pago (los pasa el dueño).
3. **Motivos de ajuste**: ¿lista fija (rotura, pérdida, conteo, vencido, otro) o texto libre?
4. Si el retiro imprime el comprobante al confirmarse, o queda para imprimir después.
5. Qué pasa con las reparaciones que descuentan stock al salir: ¿generan su propio comprobante o cuelgan del número de la reparación?

## Etapa 1 (hecha) y lo que sigue

**Hecho:** pestaña "Movimientos" con cargas (`CAR`) y ajustes (`AJU`) numerados sin saltos, fecha, motivo, referencia, observaciones, unidad de medida, stock actual y "quedará" por línea; el stock ya no se escribe en la ficha del repuesto (botón "Cambiar stock…"); la base rechaza cualquier cambio directo del stock; la importación desde Excel queda registrada como ajustes; datos de la empresa (razón social, CUIT, web) para los comprobantes. Sin costos ni precios, por decisión del dueño.

## Ideas tomadas de los manuales del sistema anterior (solo ideas, no se copia nada)

Para las etapas siguientes, de más a menos cercana:

1. **Tipo de operación como dato, no fijo en el código**: compra (suma), corrección (suma o resta), transferencia entre depósitos (resta en uno y suma en otro, en un solo comprobante), salida a un sector. Cada tipo dice si usa depósitos de origen y destino y si pide proveedor.
2. **Cabecera de una carga por compra**: proveedor (del Directorio), comprobante del proveedor y remito del proveedor por separado, y un "concepto" libre. Hoy hay un solo campo "Referencia".
3. **Transferencia entre depósitos**: un comprobante con depósito de origen y de destino. Necesita el stock por repuesto y depósito (Fase de depósitos múltiples).
4. **Control de recepción**: cantidad remitida contra cantidad recibida e inspeccionada, aprobado o rechazado y motivo del rechazo. Va con Compras (la recepción de una orden de compra).
5. **Ficha de movimientos por artículo**: todos los movimientos de un repuesto entre dos fechas, filtrable por tipo y por usuario, exportable a Excel. Hoy existe el historial por repuesto; falta el filtro por fechas y tipo.
6. **Hoja de trabajo para el conteo físico**: listado imprimible por depósito o familia para anotar lo contado; después se carga como un ajuste por conteo. Opción de no listar lo que está en cero.
7. **Datos de existencia en la ficha**: stock máximo y fecha del último inventario (además del mínimo y el punto de pedido que ya hay).
8. **Alta rápida de varios artículos seguidos** ("próximo ítem") dentro de una misma carga.
9. **Comprobantes con variables de impresión**: fecha de emisión, tipo de comprobante, punto y número, datos del destinatario, remito relacionado, transportista, destino y guía. Sirve de lista de campos para el remito de la etapa 2.
10. **Pendiente de remitir**: mercadería reservada (señada) que no salió del stock todavía. Tema de ventas; se deja anotado.

## El stock se cambia en un solo lugar (2026-10-16)

**Regla:** el stock de un repuesto cambia únicamente con la función `mover_stock()`. Esa función suma o resta, y en la misma operación anota el movimiento en la lista `movimientos_stock`
(cuánto entró o salió, cuánto quedó, de qué documento viene, el sector o el motivo y quién lo hizo). Todo lo demás (retiros, reparaciones, entregas, cargas, ajustes y sus anulaciones) la llama.
Si alguien intenta cambiar el stock por otro camino, la base lo rechaza, también el dueño de la base y la clave de servicio.

**Por qué:** antes había unos diez lugares que tocaban el stock, y cada uno tendría que acordarse de anotar el historial. Con un solo lugar, la ficha del repuesto nunca se desfasa del stock.

**La ficha** (`ficha_de_stock`): fecha, documento, concepto, entrada, salida y existencia después de cada movimiento, las más nuevas primero, de a 50 y paginada por id (índice por repuesto): sigue siendo instantánea con millones de movimientos.
Los movimientos anteriores a esta lista se pasaron al instalarla (cargas y ajustes con su saldo; retiros sin saldo). Si el primero de la ficha no parte de cero, la pantalla muestra "Saldo anterior".

**Pruebas:** la prueba de concurrencia verifica que, con 40 personas a la vez, el último saldo de cada repuesto sea su stock y que no haya saltos entre un movimiento y el siguiente. Las pruebas de lógica e integración verifican la ficha de retiros, cargas, ajustes, anulaciones y reparaciones.

**Pendiente para la etapa 2:** el número de documento de los retiros (hoy la columna Documento queda vacía en ellos), y origen y destino por depósito cuando haya varios depósitos.
