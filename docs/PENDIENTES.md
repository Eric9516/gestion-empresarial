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

## Módulos y asistente (mejoras posibles)

- **Probar el asistente y los módulos con un cliente real** y ajustar el orden y los textos de los pasos.
- **Licencia sin esperar:** la app lee la licencia cada minuto; un cambio se nota en hasta un minuto.
- **Carpetas públicas:** los archivos ya subidos se abren con su dirección exacta aunque el módulo esté apagado.
- **Cada módulo nuevo** (equipos, órdenes de trabajo) debería entrar como módulo propio de la licencia.

## Funciones nuevas planeadas

- **Equipos, sectores y documentos:** cada equipo con sus manuales y despieces (el servidor de archivos ya está listo; falta la
  tabla de fichas y las pantallas).
- **Órdenes de trabajo y mantenimiento programado.**
- **Avisos** (en la app y por correo; WhatsApp como segunda etapa).

## Operación

- **Actualizar a todos los clientes** a la vez: hoy se hace uno por uno con `pnpm cliente actualizar`.
- **Sentry** (reporte de errores): decidir si va un proyecto por cliente o uno compartido con etiquetas.
