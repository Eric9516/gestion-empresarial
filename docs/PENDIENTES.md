# Pendientes para que sea un producto

Lo que sigue **no está hecho**. Está ordenado por importancia, sin fechas.

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

## Seguridad y orden

6. **Auditoría incompleta:** faltan envíos, configuración, sectores, familias y subfamilias, y proveedores por repuesto.
7. **Historial de 200 movimientos:** agregar filtros y páginas.
8. **La configuración es legible sin sesión.** Se podría exponer solo nombre y logo, y dejar lo demás para usuarios con sesión.
9. **`usuarios_perfil` no está atado a la cuenta de acceso:** al borrar una cuenta desde el panel de Supabase queda el
   perfil huérfano. Hoy se evita borrando por la app. Se puede resolver con una relación entre ambas tablas.
10. **Copias de seguridad:** de la base (los planes gratis no las tienen restaurables) y del servidor de archivos.
11. **Entorno de pruebas propio** para probar cambios antes de aplicarlos a clientes reales (ya existe para esta plantilla:
    un proyecto de Supabase de pruebas).

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

## Módulos y asistente (mejoras posibles)

- **Probar el asistente y los módulos con un cliente real** y ajustar el orden y los textos de los pasos.
- **Licencia sin esperar:** la app lee la licencia cada minuto; un cambio se nota en hasta un minuto.
- **Carpetas públicas:** los archivos ya subidos se abren con su dirección exacta aunque el módulo esté apagado.
- **Equipos y órdenes de trabajo** deberían entrar como módulos propios (ya nacen apagados; ver `NUEVO-MODULO.md`).

## Funciones nuevas planeadas

- **Equipos, sectores y documentos:** cada equipo con sus manuales y despieces (el servidor de archivos ya está listo; falta la
  tabla de fichas y las pantallas).
- **Órdenes de trabajo y mantenimiento programado.**
- **Avisos** (en la app y por correo; WhatsApp como segunda etapa).

## Operación

- **Actualizar a todos los clientes** a la vez: hoy se hace uno por uno con `pnpm cliente actualizar`.
- **Sentry** (reporte de errores): decidir si va un proyecto por cliente o uno compartido con etiquetas.
