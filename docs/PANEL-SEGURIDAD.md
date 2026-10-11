# Panel de administración — informe de seguridad (ataque a fondo)

Fecha: 2026-10-10. Se atacó el panel como lo haría un atacante profesional, y se corrigió todo lo que apareció. Este informe dice qué se
probó, qué se encontró, qué se arregló, y **qué riesgos quedan** (que los hay).

## Cómo se atacó

| Capa | Herramienta / técnica | Resultado |
|---|---|---|
| Autenticación | Una llave de acceso **virtual** que firma de verdad y también falsifica: origen, dominio, banderas, contador, firma, desafío, tipo | Todo rechazado; mismo mensaje siempre |
| Repetición y carreras | Firmas/desafíos reutilizados; 10–100 pedidos simultáneos con la misma firma | Entra uno solo |
| Sesiones | Fijación, robo hacia otro navegador, vencimientos, pánico, tope de 3 | Todo como se diseñó |
| CSRF / origen | 11 variantes de `Origin`/`Sec-Fetch-Site`, 6 tipos de contenido, cambio de método | Todo 403/415/405 |
| Rutas | Recorrido `../`, `%2e`, `\`, byte nulo, mayúsculas, rutas largas | 404/400, nunca 500 |
| HTTP crudo | Sockets directos: contrabando de pedidos, `Content-Length` doble, encabezados enormes, URL absoluta, método raro | Rechazado |
| Entradas | Fuzzing (fast-check), inyección SQL/XSS/plantillas, caracteres de dirección (Trojan Source), ReDoS, JSON anidado/enorme, contaminación de prototipos | 400, nunca 500, nada llega a SQL |
| Autorización | Planes de otra sesión, firma de otro plan, plan sin firmar, plan vencido, proyecto de otra organización | 404/403/409 |
| Fugas | Búsqueda de 10 tipos de secreto en respuestas, tablas, auditoría, avisos y logs, con errores provocados | Ninguna fuga |
| Base de datos | Postgres **real** (no simulado), entrando con el usuario restringido de producción; 18 intentos de escalar privilegios; carreras de 30–100 conexiones | Ver hallazgos |
| Cadena de auditoría | Edición/borrado con triggers apagados | Detectado y ubicado |
| Estático | Reglas de seguridad (eslint-plugin-security, no-unsanitized), 40 verificaciones propias del código, inspección del archivo que llega al navegador | 0 errores |
| Dependencias | `pnpm audit`; revisión de scripts de instalación de todo el árbol de producción | 0 vulnerabilidades; 0 scripts |
| Navegador real | Alta, ingreso, crear cliente, módulos, auditoría y pánico bajo la CSP estricta con Trusted Types | Funciona |

**Total: 609 pruebas automáticas** (15 archivos, ~60 s), que se corren en cada cambio (CI). Las últimas 20 cubren la instalación por componentes y la operación "Instalar componente" (no se instala dos veces ni sin sus requisitos, y los requisitos se vuelven a comprobar al ejecutar). El análisis estático se repitió después de ese cambio: 0 errores.

## Hallazgos y qué se hizo

| # | Gravedad | Hallazgo | Arreglo |
|---|---|---|---|
| 1 | **Alta** | La **cadena de auditoría se rompía** con eventos simultáneos (el número de secuencia se asignaba antes del candado). Solo apareció con Postgres real | El número se asigna dentro del candado; prueba con 40 eventos simultáneos |
| 2 | **Alta** | Con conexiones reales, los datos JSON se guardaban como texto escapado (el simulador lo ocultaba) | Los datos viajan como texto y la base los convierte (`$n::text::jsonb`); independiente del cliente de Postgres |
| 3 | Media | El **tope de 3 sesiones vivas** no se cumplía con ingresos simultáneos | Candado en la creación de sesiones |
| 4 | Media | **Errores intermitentes** en el navegador: el servidor cerraba conexiones inactivas a los 5 s justo cuando el navegador las reutilizaba (el proxy de Tailscale lo habría visto como 502) | Se mantienen abiertas 120 s (más que cualquier proxy); prueba de regresión |
| 5 | Media | La redacción de secretos dependía solo de **patrones**: una llave de formato distinto se habría filtrado a un log | Además se oculta por **valor exacto** de todo secreto que el panel maneja |
| 6 | Media | Con atestación "none", nada protege la **clave pública** durante el alta: se podía guardar basura y quedarte sin acceso | Se verifica que sea un punto válido de la curva (o RSA ≥ 2048) antes de guardarla |
| 7 | Media | Las funciones de servidor que se instalan en los clientes importaban `supabase-js` con versión **flotante** (`@2`): un paquete comprometido correría con la llave de servicio de cada cliente | Versión exacta (`@2.112.3`); prueba que lo exige para siempre |
| 8 | Media | Sin tope, un error o un abuso podía crear proyectos de pago en cadena | 5 clientes nuevos por día y tope de proyectos en la organización |
| 9 | Baja | `cancelar` plan respondía "no encontrado" aunque cancelaba (devolvía el resultado del borrado de bloqueos) | Devuelve el resultado correcto |
| 10 | Baja | Un cuerpo mayor al límite, sin leer, podía dejar la conexión desfasada o cortarse con reset | Se lee entero con tope, se exige largo declarado (nada de `chunked`) y se descarta con tope |
| 11 | Baja | El rol `service_role` (resto de un diseño anterior) tenía permiso sobre las funciones | Solo `panel_app` |
| 12 | Baja | Errores sin atrapar en la interfaz al vencer la sesión; estilos en línea que la CSP habría bloqueado | Manejo global de errores; sin estilos en línea |

## Qué NO se pudo probar acá (y cómo se cubre)

* **El servidor real, Tailscale y el sistema operativo**: este informe cubre el código. El servicio de `systemd` (aislamiento), el firewall y
  Tailscale se configuran y se comprueban en la instalación (hay una lista de verificación en PANEL-INSTALACION).
* **La API real de Supabase**: las pruebas usan un simulador fiel a la documentación. Los formatos exactos de algunas respuestas (llaves nuevas
  `sb_…`, `region_selection`, despliegue de funciones) se confirman con `pnpm verificar-api` y creando un **cliente de prueba** antes de usarlo
  con un cliente real.
* **Docker**: no está operativo en esta computadora (falta WSL). Por eso no hay contenedores; el panel corre como servicio de `systemd`.

## Riesgos residuales (lo que sigue siendo posible)

1. **Cuentas raíz**: quien controle tu cuenta de Tailscale, Supabase, GitHub o DigitalOcean (o el servidor) controla el panel. Mitigación: llaves de
   acceso/2FA en las cuatro, y avisos al celular.
2. **Celular desbloqueado en manos del atacante + tu biometría**: podría firmar. Mitigación: biometría obligatoria, firma por operación (no por sesión),
   avisos, pánico, topes diarios.
3. **La llave de Supabase en el servidor**: si se roba el archivo de configuración, sirve hasta su vencimiento. Mitigación: alcance a una organización,
   permisos mínimos, vencimiento corto, rotación; el panel no tiene ninguna ruta de borrado pero la llave sí podría borrar proyectos de esa organización
   (Supabase no permite excluir "borrar" de "crear"). Por eso la organización de clientes debe estar **separada** de la de tus cosas personales.
4. **Servicios vecinos en el mismo servidor**: si el panel convive con otros servicios públicos (hoy el servidor de manuales de la fábrica), una falla de
   ellos puede alcanzarlo. Mitigación recomendada: servidor aparte.
5. **Dependencia con más árboles**: `@simplewebauthn/server` trae ~25 paquetes transitivos (analizados: sin scripts de instalación, 0 vulnerabilidades
   conocidas). Se fijan versiones exactas y se exige antigüedad mínima de 3 días.
6. **Supabase Management API** se anuncia como beta en algunos endpoints (p. ej. `database/query`): un cambio de ellos puede romper pasos (fallan de forma
   segura: el plan queda "fallido" y se puede reintentar).

## Revisiones que conviene repetir

Cada vez que se agregue una función al panel: correr toda la batería (`pnpm test` en `panel/`), repetir el análisis estático y revisar este informe.
Cada 90 días: rotar la llave de Supabase y el código de alta. Una vez, antes de dar el panel por terminado: una revisión externa independiente.
