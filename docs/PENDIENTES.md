# Pendientes para que sea un producto

Lo que sigue **no está hecho**. Está ordenado por importancia, sin fechas. Hacia dónde crece el producto: [PLAN-PRODUCTO.md](PLAN-PRODUCTO.md).

## Lo próximo (para poder entregar a un cliente real)

1. ✅/⏳ **Prueba real con Supabase.** Hecha con un cliente Plan 2 en un proyecto real de pruebas: instalación, `actualizar`, integración 185, permisos 32.640, módulos 3.220, lógica 116, planes × usuarios 63.360 y horarios 12.581, todo sin diferencias (ver [PRUEBAS.md](PRUEBAS.md), apartado 3; encontró dos defectos que ya están corregidos, ver abajo).
   Falta: un cliente real **Plan 1** y ampliarlo a Plan 2 (`pnpm cliente componente --agregar mantenimiento`) en Supabase de verdad, la app en el navegador contra el proyecto real, y crear un cliente desde el panel con la API real.
2. ✅/⏳ **Panel instalado (2026-10-11)** en el servidor de los manuales (compartido, con el cerrojo; ver "Si se comparte el servidor" en [PANEL-INSTALACION.md](PANEL-INSTALACION.md)), en `https://panel.tail4b69fd.ts.net` solo por Tailscale. Falta: poner la llave real de Supabase en `/etc/panel/panel.env`, registrar la huella desde el celular, la prueba de crear un cliente con la API real, y decidir si se cierra el SSH público. (Hecho: la llave SSH de instalación ya se retiró y el panel tiene su llave de Supabase; la huella está registrada.) Pasarlo a su propio repositorio sigue pendiente.
3. ✅/⏳ **Pase de Cremac** (producción) a la plantilla (2026-10-11): ensayado con sus datos reales en el Supabase local (`node scripts/pruebas/supabase-local/ensayo-pase.mjs <carpeta-del-respaldo>`), respaldo guardado, base real actualizada (26 migraciones, 3 funciones, 0 filas perdidas) y el sitio de Netlify apuntado al repositorio `gestion-empresarial`. Falta: probar con los 3 usuarios reales, revocar el token de lectura que se usó, y darle al panel acceso a la organización de Cremac (hoy el panel solo ve la cuenta `memoriaquiero`; Cremac está en `cantonieric1995`).
   ✅ **`pnpm cliente` ya no usa la CLI de Supabase (2026-10-12):** la CLI (v2.120) se colgaba en una consola de Windows. Ahora el instalador habla directo con la API de Supabase (`scripts/herramientas/supabase-api.mjs`), con la llave de la cuenta en `clientes/cuenta-supabase.env.local` o en `SUPABASE_ACCESS_TOKEN`. Probado con el simulador (`pnpm pruebas:instalador`, incluye llave faltante, vencida y proyecto que la llave no ve) y contra el Supabase real de Cremac en solo lectura. Falta: probarlo creando un cliente nuevo de verdad (necesita un lugar libre en Supabase) y que el dueño lo corra en su PC.
4. ✅ **Librería `xlsx` (importar y exportar Excel):** la versión de npm tenía dos fallas conocidas sin arreglo en npm; se instaló la corregida (0.20.3) desde el sitio oficial del fabricante, guardada en `vendor/` con su huella (ver `vendor/LEEME.md`) y con pruebas de lectura y escritura. `pnpm audit`: sin vulnerabilidades.
5. ✅ **Subido a GitHub** (2026-10-11/12). Ojo: el sitio de Cremac en Netlify se publica desde este repositorio, así que cada subida a `main` actualiza Cremac.
6. ⏳ **Limpieza manual:** sacar la llave SSH `claude-droplet-20261008` del archivo `/root/.ssh/authorized_keys` del servidor, y, recién cuando el socio termine de usarlo (su copia de pantallas apunta a esa base: NO borrarlo antes), borrar a mano el proyecto `ensayo-cremac` de Supabase (tiene una copia de datos reales).

7. ✅/⏳ **Reparaciones movidas al Depósito (2026-10-14).** Eran del módulo "mantenimiento" por una mala clasificación: una reparación es lo que se manda a reparar afuera (proveedor, repuestos del depósito y envío), no usa los equipos.
   Ahora son del componente Abastecimiento y las bloquea la licencia de `deposito` y `proveedores`; Mantenimiento queda para los equipos y lo que diseñe el socio. Hecho y probado en local (esquema desde cero, equivalencia con la cadena original,
   Cremac hoy + la migración nueva = instalación nueva, panel, matrices). Falta, en este orden: (a) aplicar a Cremac la migración nueva con `pnpm cliente actualizar --ref <Cremac>` **antes** de subir el código; (b) subir el código (republica Cremac);
   (c) **volver a instalar el panel en el servidor** (cambió el archivo generado con las migraciones: hasta entonces el panel instala la versión anterior); (d) volver a exportar la copia de pantallas del socio (cambiaron sus textos y reglas);
   (e) regenerar el PDF del manual del dueño (`docs/manual-del-dueno/`), que todavía dice que Reparaciones es de Mantenimiento.

## Para poder ofrecerlo a otra empresa

1. **Formatos de código propios de la primera instalación.** Las familias y subfamilias exigen **exactamente 2 letras
   mayúsculas** (restricción de la base), y el importador de familias y de stock espera la planilla de esa empresa.
   Hay que volverlos configurables o genéricos.
2. **Nombres fijos en pantalla.** "Directorio" y "Depósito de mantenimiento" están escritos en el código. Si otra empresa
   usa otras palabras, hay que sacarlos a la configuración.
3. **Formatos argentinos.** Fechas en `es-AR` (33 lugares), ejemplos con Córdoba y un solo idioma. Alcanza para Argentina y
   Latinoamérica; para vender afuera habría que abrirlo.
4. **Comisionistas y rótulos de envío** responden a cómo trabaja la primera empresa. Para otras puede no tener sentido
   (por eso son módulos que se apagan con `pnpm cliente modulos`).
5. **Lo legal y comercial:** contrato, precios, soporte, protección de datos personales, y quién es dueño del código.
6. **Posible mejora (solo si un cliente lo exige): armado del código por cliente.** Hoy hay un solo armado con todas las pantallas
   para todos los clientes: el código de un módulo no contratado viaja al navegador (es un cascarón: la pantalla redirige y la
   base de datos no entrega ni acepta ningún dato). Para que ni ese código llegue, se podría armar cada sitio con una variable
   (`VITE_COMPONENTES=base,abastecimiento`) que deje afuera lo no contratado. Costo: prender un módulo después obligaría a volver
   a publicar el sitio de ese cliente (hoy es instantáneo desde el panel) y habría más combinaciones para probar. La clave pública
   de Supabase no se puede sacar del navegador sin un servidor intermedio; la seguridad real la dan las reglas de la base
   (probadas contra la base real de Cremac el 2026-10-12: sin sesión no se puede escribir, ni listar archivos, ni crear cuentas).
7. **Ajuste chico de seguridad:** la tabla `configuracion` es legible sin iniciar sesión (a propósito: el ingreso muestra nombre,
   logo y colores). Si algún día se cargan dirección, teléfono o email de la empresa ahí, también serían visibles. Conviene dejar
   visible a un anónimo solo nombre, logo y colores.

## Seguridad y orden

6. **Auditoría incompleta:** faltan envíos, configuración, sectores, familias y subfamilias, y proveedores por repuesto.
7. **Historial de 200 movimientos:** agregar filtros y páginas.
8. **La configuración es legible sin sesión.** Se podría exponer solo nombre y logo, y dejar lo demás para usuarios con sesión.
9. **`usuarios_perfil` no está atado a la cuenta de acceso:** al borrar una cuenta desde el panel de Supabase queda el
   perfil huérfano. Hoy se evita borrando por la app. Se puede resolver con una relación entre ambas tablas.
10. **Copias de seguridad:** de la base (los planes gratis no las tienen restaurables) y del servidor de archivos.
11. **Entorno de pruebas propio** para probar cambios antes de aplicarlos a clientes reales (hoy no hay uno: el de la plantilla se borró;
    se crea con la segunda cuenta de Supabase de pruebas).

## Errores encontrados en la prueba exhaustiva (2026-10-09)

Se probó una copia de la base de Cremac con 272 configuraciones de usuario (32.640 comprobaciones de permisos), 38
combinaciones de módulos, la lógica de stock, reparaciones, tareas, funciones de usuarios, auditoría y las pantallas.
Los **permisos y los módulos pasaron sin diferencias**. Lo que apareció venía de Cremac. **Quedó corregido en la plantilla**
(migraciones `...0600`, `...0700` y `...0800`, funciones del servidor y pantallas) salvo lo marcado como pendiente;
Cremac lo recibe con el pase a la plantilla. Se anota igual para que quede el registro:

1. ✅ **Contactos de proveedores legibles sin iniciar sesión.** La regla de lectura de `contactos` (y de `planilla_familias`)
   está abierta al público, y la clave pública está dentro del código de la página. Cualquiera puede bajar nombre, cargo,
   teléfono y mail de todos los contactos. Arreglo: limitar esas dos lecturas a usuarios con sesión.
2. ✅ **"Bloquear usuario" no se aplica en la base.** Solo lo comprueba la pantalla al iniciar sesión. Un usuario bloqueado que
   ya tiene la sesión abierta sigue trabajando, y por la API directa puede iniciar sesión, leer y escribir con sus permisos.
   Arreglo: que los permisos de la base también exijan `activo = true`.
3. ✅ **Crear una tarea falla de 21:00 a 24:00 (hora de Argentina).** La base calcula "hoy" en hora universal (UTC) y la pantalla
   en hora local; la base rechaza "fecha anterior a hoy". Afecta también a reprogramar y arrastrar tareas. Arreglo: calcular
   "hoy" con la zona horaria del cliente.
4. ✅ **Los mensajes de error de varias pantallas salen vacíos** ("Error al guardar:"): el código solo muestra el mensaje si el
   error es de tipo `Error`, y los errores de la base no lo son.
5. ✅ **Eliminar usuario exige ser dueño Y administrador del Directorio.** La pantalla le muestra el botón a cualquier dueño y
   falla con "solo administradores". Arreglo: que la función solo exija ser dueño.
6. ✅ **Pantalla "No hay módulos disponibles"**: dice que el dueño los active en "Configuración → General → Módulos", que no
   existe (solo el vendedor los cambia). Cambiar el texto.
7. ⏳ **El historial no registra la creación de un retiro**, solo sus correcciones y borrados. Se dejó así a propósito (cada retiro llenaría el historial); decidir si se quiere cambiar.
8. ✅ **`exigir_modulo` se podía ejecutar sin sesión.** Ahora ninguna función propia queda abierta, y la prueba lo vigila.
9. ⏳ El registro público de usuarios hay que apagarlo a mano en Supabase (paso 5 del manual); el instalador ahora lo comprueba y avisa si sigue abierto.
10. ✅ **El historial de retiros agrupaba por día en hora universal:** un retiro hecho después de las 21:00 aparecía en el día siguiente y el filtro por día lo dejaba afuera. Ahora usa el día local.

## Lo que apareció al probar con un Supabase real y con los horarios (2026-10-11)

Se instaló un cliente Plan 2 en un proyecto real de Supabase de pruebas y se corrieron contra él todas las baterías (ver [PRUEBAS.md](PRUEBAS.md)). Salió esto:

1. ✅ **La ventana de "24 horas" de los retiros vencía a las 21:00 de Argentina.** Las reglas de edición pedían a la vez "menos de 24 horas" y "creado el mismo día calendario UTC".
   Un retiro hecho a las 18:00 no se podía corregir ni devolver parcialmente a la mañana siguiente, aunque la pantalla decía "podés devolver hasta 24h". Corregido con la migración
   `abastecimiento/20260101001200_retiros_ventana_de_24_horas.sql` (las dos condiciones son ahora "menos de 24 horas"). **Cremac tiene el mismo defecto**: lo recibe con el pase. Se comprobó en Supabase real antes y después.
2. ✅ **La tabla del registro de migraciones quedaba con permisos para `anon` y `authenticated`.** Supabase da permisos por defecto a las tablas nuevas y esta la crea el instalador, no una migración.
   No se podían leer ni escribir filas (la protección por filas bloqueaba todo), pero faltaba la capa de permisos. El instalador y el panel ahora los quitan; una prueba del instalador lo vigila.
3. ⏳ **Decisión pendiente: agregar líneas a un retiro viejo.** La regla de alta de líneas (`retiro_items_insert`) no tiene límite de tiempo: se pueden sumar líneas a un retiro propio de hace días, aunque no se pueda editarlo ni borrarlo.
   Se dejó igual (es lo que hace Cremac y la pantalla no lo ofrece); se anota por si se quiere alinear con las 24 horas.
4. ⏳ **El vencimiento del acceso (`access_expires_at`) y el estado "prueba"/"expirado" solo afectan a Tareas.** Un usuario con el acceso vencido sigue pudiendo usar el Directorio y el Depósito; solo pierde las tareas.
   Es lo que dice el código (heredado de otra aplicación); si el vencimiento tiene que cortar todo, hay que pedirlo.
5. ℹ️ **Zonas horarias:** el PostgreSQL de Supabase tiene otros datos que Node para Marruecos (`Africa/Casablanca`). La app no ofrece esa zona. Las 11 zonas que sí ofrece coinciden en cada instante probado.
6. ⏳ El registro público de usuarios del proyecto de pruebas sigue abierto (paso manual; el instalador avisa).

## Módulos y asistente (mejoras posibles)

- **Probar el asistente y los módulos con un cliente real** y ajustar el orden y los textos de los pasos.
- **Licencia sin esperar:** la app lee la licencia cada minuto; un cambio se nota en hasta un minuto.
- **Carpetas públicas:** los archivos ya subidos se abren con su dirección exacta aunque el módulo esté apagado.
- **Equipos con documentación y órdenes de trabajo:** Mantenimiento ya es un módulo propio (equipos y reparaciones); falta lo demás (manuales, despieces, órdenes de trabajo). Nacen apagados; ver `NUEVO-MODULO.md`.

## Funciones nuevas planeadas

- **Equipos, sectores y documentos:** cada equipo con sus manuales y despieces (el servidor de archivos ya está listo; falta la
  tabla de fichas y las pantallas).
- **Órdenes de trabajo y mantenimiento programado.**
- **Avisos** (en la app y por correo; WhatsApp como segunda etapa).

## Operación

- **Actualizar a todos los clientes** a la vez: hoy se hace uno por uno con `pnpm cliente actualizar`.
- **Sentry** (reporte de errores): decidir si va un proyecto por cliente o uno compartido con etiquetas.

## Panel de administración ("central de control")

Construido y atacado (ver [PANEL-DISENO.md](PANEL-DISENO.md), [PANEL-SEGURIDAD.md](PANEL-SEGURIDAD.md), [PANEL-INSTALACION.md](PANEL-INSTALACION.md)). Hace hoy: lista de clientes con estado y componentes,
crear cliente (instalando solo los componentes que contrata), actualizar, cambiar módulos e **instalar componentes**, con firma de llave de acceso por operación; varias organizaciones de Supabase
y "datos para publicar la app". Pendiente:

- ⏳ **Instalarlo en un servidor** y probarlo con la API real de Supabase con un cliente de prueba (ver "Lo próximo", puntos 1 y 2).
- ⏳ **Funciones que se pueden sumar, de menor a mayor riesgo** (cada una con su propia revisión de seguridad): panel de salud de todos los clientes (versión, migraciones
  pendientes, errores); restablecer la contraseña del dueño; publicar el sitio del cliente (necesita otra llave, la de Netlify); backups por cliente.
- ⏳ **Funciones de alto riesgo** (no hechas a propósito): borrar proyectos, restaurar backups. Si se agregan: doble firma y escribir el nombre del cliente.
- ✅ Íconos: toda la app usa un solo componente (`src/components/Icono.tsx`, íconos de la librería lucide) en lugar de emojis, y una prueba (`src/lib/iconos.test.ts`) impide que vuelvan.
- ⏳ Resto del pulido de diseño (colores, tipografías, ordenar estilos repetidos) en las apps de clientes: pedido aparte.

## Hacia una suite completa para vender (decidido 2026-10-16; no se construye todavía)

La intención es salir a vender un sistema integral, no solo para una empresa. Hacen falta, además de lo operativo (depósitos, requerimientos, compras, orden de pago), las áreas **contable, impositiva, de recursos humanos, de ventas y de fondos**.
Se toma como modelo un sistema administrativo existente (21 documentos revisados): se replica lo que hace y se mejora cómo lo hace. **Antes de construir algo de esto, se redacta la versión nueva de [PLAN-PRODUCTO.md](PLAN-PRODUCTO.md) y se revisa junto con el dueño.**

Componentes nuevos a sumar (cada uno se enciende o se apaga por plan, como los demás):
- **Contabilidad**: plan de cuentas (hasta 15 niveles; cuentas que agrupan y cuentas que reciben asientos), asientos, mayor, balances, diario foliado, libros de IVA compras y ventas, centros de costo. Una cuenta con movimientos no se borra.
- **Fondos** (dentro de Administración o aparte): caja, bancos, cartera de cheques de terceros con estados (en cartera, entregado, depositado), cheques propios, libro de bancos, órdenes de pago y recibos contra comprobantes seleccionados, con pagos y cobros a cuenta.
- **Ventas**: facturación electrónica de ARCA, facturar y remitir después (mercadería pendiente), listas de precios, notas de venta con cláusulas, recibos con varios valores, intereses sobre cuentas corrientes, anticuación y proyección de saldos.
- **Recursos Humanos**: primero legajos y novedades; después la liquidación de sueldos (conceptos con fórmulas y cuenta contable, recibos, libro de sueldos, informes configurables).
- **Terceros unificados**: una sola ficha para cliente, proveedor y socio (con sus relaciones, datos impositivos, condiciones de venta y de compra, límite de crédito, calificación, zona y ruta). Compras, Ventas y Fondos dependen de esto.
- **Comprobantes**: borrador antes de procesar (se carga y se corrige; al procesar se registra y no se toca más), número correlativo, reimpresión y documentos relacionados.

La mejora principal frente al sistema de referencia: **cada comprobante genera su asiento contable solo** (en el de referencia se arman a mano) y no hay datos duplicados entre áreas (allá modificar un asiento obliga a borrar también en Fondos). Eso pide construir temprano el núcleo contable (plan de cuentas y motor de asientos), aunque sea mínimo.

Orden propuesto (a revisar): 1) operativo, 2) núcleo contable y fondos, 3) ventas con facturación electrónica, 4) recursos humanos.

Riesgos: la parte impositiva, de facturación y de sueldos depende de normas que cambian, y un error lo paga el cliente. Hace falta que un contador y alguien de liquidación de sueldos validen lo construido, y un proceso para actualizar cuando cambia una norma. Se puede aprovechar trabajo ya hecho en otros proyectos del dueño (estados contables y generación de asientos desde ARCA).
No se construye (queda para si un cliente lo pide): lo propio de cooperativas de servicios (lectura de medidores con colectores, liquidación de obras de pavimento).
