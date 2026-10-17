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
- **Es una función de cada depósito, no del módulo de Compras** (decidido el 17 de octubre; ver "Quién hace qué"). La hace la gente del depósito y también puede hacerla Compras.
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
3. **Compras** (órdenes de compra) y **recepción** (remito de ingreso). La recepción es del **Depósito** y funciona también sin Compras (un ingreso suelto, sin orden); con Compras,
   el mismo ingreso se vincula a una o más órdenes y descuenta su saldo. Compras depende de Depósito, nunca al revés.
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

## Varios depósitos: el modelo y la estructura hecha (etapa 1, 2026-10-16)

**Un depósito es un área con SU catálogo, su stock y sus usuarios.** Cada depósito tiene su propia **letra**: los repuestos de Mantenimiento empiezan con la M, los de otro depósito con la suya. Un repuesto pertenece a **un solo depósito**
(nadie compra lo que no usa: Mantenimiento los rodamientos, la planta de dulce los tarros). Por eso el stock sigue siendo el del repuesto (`items.stock`) y no hace falta una tabla de stock por depósito.

**Qué hay (base de datos):**
- `depositos`: código, nombre, **letra** (única), punto de venta para numerar sus comprobantes, activo y cuál es el principal (el primero: recibe lo que ya existía y es el depósito de quien no tiene otro).
- `items.deposito_id`: a qué depósito pertenece cada repuesto. Lo que se carga sin decirlo va al principal.
- `usuarios_depositos`: a qué depósitos tiene acceso cada persona. Por defecto uno solo (quien recibe acceso al depósito queda asignado al principal); con permiso sobre otros, puede hacer **lo mismo que ya podía, en todos los asignados**. El dueño ve todos, siempre.
- `crear_repuesto` crea en el depósito pedido (entre los del usuario) o en el suyo, y el código empieza con la letra de ese depósito; la **numeración es de cada depósito**.
- Cada movimiento de la ficha anota el depósito de su repuesto.
- Todo lo que hay en Cremac queda en el depósito principal, con la letra que ya usan sus códigos (la M).

**Regla de visibilidad (etapa siguiente, en la base y no en la pantalla):** cada persona ve solo los repuestos, retiros, ajustes, movimientos, reparaciones e informes de sus depósitos. Mantenimiento no ve nada de Insumos.
Un retiro, una carga o un ajuste es de **un** depósito (todas sus líneas del mismo) y se numera con el punto de venta de ese depósito.

**Pedidos entre depósitos** (Producción le pide cajas a Insumos): Producción **busca** artículos de los depósitos que "aceptan pedidos de otras áreas" (solo código, descripción y unidad; sin stock). Insumos lo entrega con un **retiro de su stock con destino Producción**:
se da de baja en Insumos y **no pasa al stock de Producción** (ya es para usar). Lo que sobra vuelve como carga con el motivo "Devolución de un sector". No hay transferencias entre depósitos ni artículos duplicados.

Se retira **solo del propio depósito**: quien es de Mantenimiento retira de Mantenimiento. Quien tiene más de un depósito retira del que tiene elegido en el selector: cada depósito tiene su propio "A retirar" (lo que se agregó en uno queda guardado en ese depósito al cambiar de selector) y confirmar crea un retiro de ese depósito, con su número y su comprobante. Nunca se mezclan depósitos en un retiro. Si un supervisor necesita sacar algo y no corresponde un retiro común, lo hace en **Movimientos → Ajuste de ese mismo depósito**: resta el artículo y aclara el motivo ("Material retirado sin anotar", u "Otro" con su texto); queda con comprobante numerado y con su nombre.

**Pedirle algo a otra área:** no se retira, se hace un **requerimiento**. Puede hacerlo cualquier persona (por ejemplo, alguien de Mantenimiento pidiéndole bidones de agua a Insumos), porque pedir no saca nada de ningún stock. Quien decide es el área que recibe: solo sus usuarios autorizados lo aceptan, lo entregan y lo descuentan de su depósito (ver "Pedidos entre depósitos"). Cada depósito indica si acepta pedidos de otras áreas.

**Tope de depósitos por cliente:** valor inicial por plan 1 / 3 / 10, configurable por cliente desde el panel (es una decisión comercial: el límite técnico es mucho más alto). Antes de publicar la etapa 2 se mide con 1.000.000 de repuestos repartidos en 10 depósitos y 40 usuarios a la vez.

**Quién define los depósitos:** al crear el cliente desde el panel (cantidad, nombres y letras; por defecto uno solo) y después el dueño los edita desde Configuración. Con un solo depósito la app se ve como siempre (sin selectores).

**Lo que falta, en orden:**
1. ✅ **Hecho (2026-10-17): depósitos que el dueño crea y edita** (nombre, color, ícono y letra), con el tope de la licencia (`licencia.max_depositos`, 1 por defecto) y las funciones `crear_deposito` / `editar_deposito` (solo el dueño; nunca se borran, se desactivan; la letra se fija con el primer repuesto). Pantalla: Configuración → Depósito → Depósitos. Falta: asignar personas a depósitos, elegir depósito en las pantallas de quien tiene varios, separar lo que ve cada depósito (reglas de seguridad) y la cantidad/nombres al crear un cliente desde el panel (además del tope por plan).
2. Mínimos y punto de pedido siguen siendo del repuesto (no hace falta por depósito); el informe de reposición se arma por depósito.
3. Pedidos entre depósitos y requerimientos (etapa de Compras).
4. Numeración de los comprobantes con el punto de venta del depósito.

**Lección técnica:** al mover stock hay que pedir el candado del repuesto en modo "sin clave" (`FOR NO KEY UPDATE`); con el fuerte (`FOR UPDATE`) dos retiros del mismo repuesto se trababan entre sí (77 bloqueos mutuos en la prueba de 40 usuarios).

## Quién hace qué: decisiones del 17 de octubre de 2026

Sale de una conversación con el dueño del producto. Corrige dónde vive la recepción y agrega los permisos de requerimientos e informes.

**Recepción: una función de cada depósito.** Cuando llega la mercadería, la persona del depósito carga el remito, lo vincula con su orden de compra, selecciona lo que llegó y, según una casilla ("Agregar al stock"), suma o no al stock. La puede hacer también la persona de Compras, con el mismo permiso: no hay dos formas de recibir. Sin el módulo de Compras, la recepción sigue funcionando como ingreso suelto (proveedor, remito y líneas, sin orden). Compras depende de Depósito, nunca al revés.

**Proveedores y presupuestos.** Los puede gestionar Compras o la gente del depósito. **El presupuesto no se guarda en el sistema**: quien lo consigue se lo pasa a Compras por correo, y en el requerimiento solo queda el proveedor sugerido (como ya estaba). Las órdenes de compra siguen escribiendo el precio a mano.

**Requerimientos desde el depósito: permiso apagado por defecto.** No es un módulo para todo el depósito sino un permiso por persona. Un administrador de Compras lo habilita a quien considere que puede hacer esa tarea (se asigna desde el panel de permisos de usuarios, como los demás indicadores de `usuarios_perfil`).

**Informe (la pestaña "Informe" del Depósito, el de stock y compras): no lo ve cualquier operario.** Lo ven los administradores de ese depósito, o quien Compras haya habilitado desde el panel de permisos. Hoy la pantalla ya lo muestra solo al administrador; lo nuevo es el permiso individual que Compras puede dar a un operario, y que la base de datos (no solo la pantalla) haga cumplir quién lo ve. Otras listas (retiros, historial de movimientos, exportaciones) no cambian.

**Compras ve todos los depósitos.** Esa vista llega con el panel de Compras, que se arma más adelante. El dueño sigue pudiendo hacer todo.

**El depósito original se llama "Depósito 1" por defecto** (el dueño le cambia el nombre, el color y el ícono desde Configuración → Depósitos; la letra del código se fija con el primer repuesto). Hoy el nombre "Depósito de mantenimiento" está escrito fijo en la pantalla y hay que sacarlo.

**Nuevo rol: administrador de Compras.** Hoy no existe. Habilita permisos a usuarios de depósito. Recomendación: un permiso más que se asigna, no un rol aparte.
