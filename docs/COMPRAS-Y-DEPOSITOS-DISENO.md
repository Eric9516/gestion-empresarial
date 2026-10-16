# Compras, requerimientos y varios depósitos — diseño

Estado: **diseño acordado con el dueño del producto (15 de octubre de 2026). Todavía no se construyó nada.** Sale de una conversación larga y de 11 capturas
del sistema que usa la fábrica (un SAE genérico), que se tomaron como referencia de proceso y no como algo para copiar tal cual.
Encaja con las etapas E3 (requerimientos), E4 (Administración: compras y pagos) y E5 (varios depósitos) de [PLAN-PRODUCTO.md](PLAN-PRODUCTO.md).

## 1. Qué se quiere lograr

Que cada área de una empresa (Mantenimiento, Producción, Insumos...) tenga su **depósito**, pida lo que necesita con un **requerimiento**, y que Compras lo
resuelva con una o más **órdenes de compra**, que el área **recibe** (total o en partes) contra el **remito** del proveedor. También que un área pueda pedirle
material a otra. Todo con el rastro completo: requerimiento → orden de compra → remito → (más adelante) orden de pago.

## 2. Principio rector: genérico, no "como lo hace Cremac"

El sistema de la fábrica es genérico y el nuestro también tiene que serlo. Cuatro niveles, de lo más fijo a lo más propio de cada empresa:

| Nivel | Qué es | Ejemplos |
|---|---|---|
| **Proceso base** | Igual para todas las empresas, va fijo | requerimiento → orden de compra → remito; saldo pendiente por línea; reglas de edición |
| **Decisión del momento** | Una casilla en cada línea, sin configuración | "agregar al stock" al recibir; "queda en el stock de quien pidió" al entregar entre depósitos |
| **Opción de la empresa** | Se prende o apaga; **apagada por defecto** | aprobación de requerimientos, centros de costo, impuestos |
| **Datos de la empresa** | Los carga cada empresa | nombres y cantidad de depósitos, numeración de cada uno, sectores (los destinos) |

Genérico **no** es configurarlo todo: cada opción hay que probarla y mantenerla. Se empieza con pocas y se suman cuando un cliente real las pide.

## 3. El recorrido

```
ÁREA (depósito)                COMPRAS                          ÁREA (depósito)
REQUERIMIENTO  ────────────►   ORDEN(ES) DE COMPRA  ────────►   RECEPCIÓN (remito)
(qué y cuánto, destino,        (una por proveedor;              (total o parcial; elige si
 proveedor sugerido)            precios escritos a mano)          suma al stock)
                                                                          │
                                                      (más adelante) ORDEN DE PAGO
```

- **Un requerimiento puede generar varias órdenes de compra** (Compras pide presupuesto a varios proveedores, **compara afuera**, y hace una orden por proveedor
  elegido). **No hay comparador automático**: los proveedores presentan los ítems con otro orden, descripciones y códigos, y un comparador fallaría.
- **Una orden de compra es de un solo depósito** (el que pidió) y **solo ese depósito la ve**. Compras ve todas.
- **Un remito puede traer líneas de varias órdenes** del mismo proveedor (en el sistema de la fábrica la orden está en cada línea).

## 4. Reglas por documento

### Requerimiento
- Lo carga un depósito: ítems con cantidades, **destino** (un sector de la empresa o "stock general") y, si quiere, un **proveedor sugerido**.
- **Lo modifica quien lo hizo (y el administrador del depósito) hasta que se emite la primera orden de compra.** Después ya no se toca: si falta algo, se hace
  otro requerimiento. Mientras no tenga orden, también se puede **anular**. Si Compras anula la orden antes de recibir nada, vuelve a quedar editable.
- Sin aprobación previa (llega directo a Compras). Si una empresa la necesita, es una opción que se prende.
- Controla lo **cubierto** por órdenes: avisa si se pide de más.

### Orden de compra
- Solo la edita **Compras**. Se arma desde un requerimiento: elige los ítems que van a ese proveedor y **escribe el precio de cada uno a mano**.
- Puede **cambiar cantidades y agregar líneas que no estaban pedidas** (fletes, gastos) sin rehacer el requerimiento. Cada línea marca si vino del requerimiento o
  la agregó Compras; la orden guarda lo **pedido** y lo **ordenado**. El depósito la ve completa, con esas marcas.
- **Se puede modificar después de la primera entrega**, protegiendo lo recibido: la cantidad de una línea **nunca baja de lo ya recibido**; lo pendiente se puede bajar
  (equivale a cancelar el saldo de esa línea) o subir; se pueden agregar líneas; el **precio se puede corregir con un motivo obligatorio**; el **proveedor no cambia** si
  ya hay remitos. Todo cambio posterior a la primera entrega queda en el historial y el depósito lo ve.
- **Estados:** abierta (nada recibido), recibida en parte, **completa** (automático cuando llegó todo lo pedido; no hay nada que cerrar), **cerrada** (a mano, solo si
  quedó saldo pendiente, con un motivo), **anulada** (solo si no tuvo ninguna entrega).

### Recepción (el remito del proveedor)
- El depósito abre un modal: **elige al proveedor** (por código o nombre; se completan sus datos), carga **número y fecha del remito**, y ve **sus órdenes con saldo**
  (solo las de su depósito). Puede tildar **una o varias**.
- Aparecen todas las líneas pendientes juntas, cada una con su **casilla de ingresar** y la **cantidad a recibir** (por defecto el saldo; se edita para las entregas parciales).
- Cada línea tiene la casilla **"Agregar al stock"** (por defecto tildada). Para un servicio (por ejemplo, "reparación de hidrolavadora") se destilda. La línea se da por
  recibida igual: el saldo de la orden baja.
- Se guardan **dos fechas**: la del remito del proveedor y la de carga. Los remitos quedan imputados al proveedor y a las órdenes.
- Nombre claro: es un **remito de ingreso**, distinto de la "nota de despacho" (de salida, que hoy se usa en las reparaciones).

### Pedido entre depósitos
- Un depósito le pide a otro. El que entrega baja de su stock; **cada línea tiene la casilla "Queda en el stock del que pidió"**: tildada es una **transferencia** (sube el
  stock del que pidió, con un estado "en camino" hasta que lo recibe); destildada es un **consumo** (queda registrado que lo consumió esa área).
- Si el depósito pedido no tiene, el pedido puede **convertirse en compra** sin cargarlo de nuevo.

## 5. Datos y cambios sobre lo que ya existe

- **Depósitos**: los define cada empresa (área). Cada persona se asigna a uno o más depósitos; **la base de datos hace cumplir** quién ve qué, como en el resto del sistema.
- **Stock por depósito.** Hoy cada repuesto tiene un único stock; pasa a ser uno por depósito.
- **Stock mínimo y punto de pedido por depósito** (no por repuesto). El **informe de reposición se arma por depósito**; de ahí sale el requerimiento del área.
  Los valores actuales de Cremac pasan al depósito de Mantenimiento.
- **Todo movimiento de stock guarda el documento que lo originó** (remito de recepción, retiro, transferencia, ajuste) con su número, los depósitos de origen y destino y el
  proveedor, y el historial del repuesto lo muestra y permite abrirlo.
- **Numeración por documento y por depósito**, con punto de venta y correlativo (ejemplo del sistema de la fábrica: `REQ 0028-00001938`, `OCO 0001-00020337`). Se configura.
- **Destino del requerimiento = un sector** (ya existe la tabla de sectores) o "stock general". No se usan centros de costo ni obras.
- **El catálogo**: el código es sección (`M`) + familia + subfamilia + número. Sección y depósito son conceptos distintos: un artículo tiene una sección y su stock se reparte
  entre depósitos.
- **El stock no puede quedar negativo** (como hoy).
- **Listas de documentos** con el **primer ítem** como referencia (para reconocer cada documento), estado, importe, y acciones: ver documentos relacionados, **clonar**, editar.
  Los números de requerimiento y de orden se pueden tocar para abrir el documento.
- **Búsqueda de repuestos con varios depósitos**: stock por depósito y total, **"pendiente de recibir"** (saldo de órdenes abiertas, para no comprar de más), "solo con stock",
  exportar a Excel con o sin stock y precios, y búsqueda por código de barras.
- Detalle del repuesto: historial de **compras** (en qué órdenes y remitos aparece, proveedor y precio) y precio con fecha del último cambio.
- Quedan los nombres separados: **requerimiento** es el pedido a Compras o a otro depósito; **retiro** es la salida de material.

### El PDF de la orden de compra

Se genera con los datos de la empresa (logo, CUIT, domicilio, tomados de la configuración) y los del proveedor, el requerimiento citado en su propio campo, las líneas con código,
descripción, cantidad, precio y total, y subtotal, **IVA** (una alícuota por orden, 21% por defecto, editable) y total, observaciones y condiciones (texto configurable). Lleva **solo lo que
el proveedor necesita**: quién pidió, el área y el destino son datos internos y no se imprimen. Los renglones vacíos no se imprimen, y si hay más líneas que las de una hoja sigue en la
siguiente con el encabezado repetido.

## 6. Qué se deja afuera por ahora

Impuestos (IVA, impuestos internos, percepciones, retenciones), centros de costo y obras, comparador y cotizaciones dentro del sistema, factura del proveedor,
contabilidad (cuentas por artículo), ventas, comercio electrónico, doble aprobación. Cualquiera de ellas se puede sumar después como opción.

## 7. Orden de construcción propuesto

1. **Depósitos**: varios depósitos por empresa, stock y mínimos por depósito, permisos por depósito y transferencias. Es la etapa delicada porque cambia cómo se guarda el
   stock: se ensaya antes sobre una copia de los datos de Cremac, con la misma batería de pruebas que ya existe.
2. **Requerimientos**, entre depósitos y hacia Compras.
3. **Compras**: órdenes de compra y recepción (remito de ingreso). Van **juntas en el componente de Compras/Administración**: la recepción apunta a la orden y
   Abastecimiento no puede depender de Compras; al recibir, Compras le pide a Abastecimiento que sume el stock.
4. **Orden de pago**, simple al principio (sin retenciones).

## 8. Pendientes por decidir

1. Una orden **completa**, ¿acepta líneas nuevas (un flete posterior; volvería a "recibida en parte") o queda cerrada para siempre?
2. Al **cerrar una orden con saldo**, lo que no llegó, ¿vuelve disponible en el requerimiento para pedirlo a otro proveedor, o queda cancelado?
3. **Orden de pago**: no hubo pantallas de ejemplo. ¿Se paga contra la factura del proveedor (hay que cargarla) o contra el remito/orden? ¿Cuándo se hace?
4. **Depósitos de Cremac**: cuántos son, cómo se llaman y qué guarda cada uno, para convertir el stock actual.
5. **Fecha de vencimiento o de entrega prometida** en la orden de compra, para marcar atrasos (no se vio en las capturas).
6. Si una **compra que se consume directo** necesita un camino aparte ("salida directa") o alcanza con recibirla sin sumar al stock y retirarla.

## El requerimiento impreso: ejemplo del sistema de la fábrica (2026-10-16)

El dueño pasó un requerimiento real (REQUERIMIENTO 0028-00002528, 21/09/2026, "Solicita: Requerimiento de Mantenimiento"). Se toma como **ejemplo para mejorar, no para copiar**.

**Qué trae:** encabezado en dos bloques (a la izquierda logo, domicilio, teléfono, correo y web de la empresa; a la derecha el tipo de documento, el número `0028 00002528` y la fecha); "Solicita" (el área), "Cuenta" (código contable), "Destino interno"; tabla con código de artículo, cantidad, **unidad de medida**, descripción y **fecha de entrega por línea**; recuadro de observaciones; al pie, operador y fecha y hora.
Los códigos son los mismos que usa este producto (`M` + familia + subfamilia + 5 dígitos, por ejemplo `MRMED00001`) e incluyen un **artículo de servicio** (`MSRFL00001`, "Flete") en el mismo requerimiento.

**Qué se toma:**
- El número con **punto de venta + correlativo de 8 dígitos** (`0028-00002528`); el punto de venta es el depósito o área que lo emite.
- Encabezado de la empresa tomado de la configuración, tipo y número bien visibles, fecha.
- **Unidad de medida** en cada línea (hoy los artículos no la tienen: hay que agregarla al catálogo).
- **Artículos de servicio** (flete, reparación, mano de obra) que se piden y se compran pero **nunca suman stock**: una marca en el artículo ("no maneja stock").
- **Fecha requerida por línea** (para que Compras sepa qué es urgente).
- Observaciones, y al pie quién lo hizo y cuándo.

**Qué se mejora:**
- Una hoja A4 que se ajusta al contenido (la del ejemplo reserva una caja enorme vacía) y que **sigue en la página siguiente con el encabezado repetido** y "página 1 de 2".
- **Código QR** que abre el documento en la app (ver estado, recibir mercadería) escaneándolo desde el papel.
- Número de línea, cantidades alineadas, descripciones completas, y **firmas** (quien pide y quien autoriza) cuando la empresa las use.
- Los campos "Cuenta" y "Destino interno" son opcionales y con nombres claros ("Sector de destino", "Cuenta contable" solo si la empresa la usa); no se imprimen en el documento que va al proveedor (ya decidido: la orden de compra no muestra quién pide ni el sector).

## Varios depósitos: estructura hecha (etapa 1, 2026-10-16)

**Qué hay:** la tabla `depositos` (código, nombre, punto de venta para numerar sus comprobantes, activo, uno solo marcado como principal) y la tabla `stock_por_deposito` (repuesto + depósito → stock, nunca negativo).
Todo el stock que había pasó al **depósito principal** ("Depósito principal", renombrable). `items.stock` sigue existiendo y es el **total** (la suma de los depósitos): lo siguen usando el catálogo, el carrito, el informe de reposición y todo lo que ya andaba.

**Reglas:**
- El stock se mueve solo con `mover_stock(repuesto, cantidad, …, depósito)`. Sin decir el depósito, va al principal. Si el depósito no alcanza, se rechaza aunque el total sí alcance ("hay 5 y se necesitan 7").
- Cada movimiento de la ficha anota su depósito, y su saldo es el de ese depósito.
- Orden de candados: primero el repuesto (candado "sin clave", que no choca con el que ya tiene quien inserta una línea que lo menciona) y después la fila de su depósito. Con el candado fuerte (`FOR UPDATE`) la prueba de 40 usuarios dio 77 bloqueos mutuos y el rendimiento cayó de 220 a 35 operaciones por segundo; con `FOR NO KEY UPDATE`, cero bloqueos y 212 por segundo.
- Control de integridad: `repuestos_sin_cuadrar_con_sus_depositos()` tiene que dar 0 (la prueba de concurrencia lo verifica). `reconstruir_stock_por_deposito()` rearma el principal desde el total (herramienta de reparación y de carga de datos de prueba; no es para personas).

**Lo que falta, en orden:**
1. Elegir depósito en las pantallas (búsqueda, retiro, movimientos, ficha) y el nombre y alta de depósitos para el dueño.
2. Mínimos y punto de pedido **por depósito** (hoy son del repuesto) y el informe de reposición por depósito.
3. Permisos por depósito (quién ve y mueve cuál).
4. Transferencias entre depósitos (un comprobante con origen y destino) y numeración por depósito.
5. Reparaciones, retiros y ajustes con depósito explícito en la base (hoy van al principal).
