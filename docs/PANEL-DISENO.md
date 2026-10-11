# Panel de administración de clientes — diseño y modelo de amenazas

Este panel reemplaza al comando `pnpm cliente` (crear cliente, actualizar, cambiar módulos, instalar componentes) con una página que se usa desde
el celular. Es **solo para el proveedor** (vos). Vive en la carpeta `panel/`, con sus propias dependencias, y **nunca** forma
parte de lo que se publica a los clientes.

> Nada es "impenetrable". El objetivo es que atacarlo cueste más que cualquier otra cosa que valga la pena atacar, que un fallo
> parcial no alcance para hacer daño, y que todo intento deje rastro. Resultados de los ataques: [PANEL-SEGURIDAD.md](PANEL-SEGURIDAD.md).
> Cómo instalarlo: [PANEL-INSTALACION.md](PANEL-INSTALACION.md).

## Cómo está armado

```
 Celular (Tailscale + llave de acceso)
        │  HTTPS (certificado de Tailscale), solo dentro de tu red privada
        ▼
 Servidor propio ── tailscale serve ──► panel (Node, solo escucha en 127.0.0.1) ──► Postgres local (usuario panel_app)
                                                │
                                                └──► API de Supabase (llave con alcance a UNA organización)
                                                └──► proyectos de clientes (llave de servicio leída en el momento, nunca guardada)
```

* **Un solo archivo para ejecutar** (`dist/panel.mjs`, con sus dependencias adentro) + la interfaz (`dist/web`). En el servidor no
  se corre `npm install`: se arma en tu computadora/CI y se copia, con su huella `sha256`.
* **Base propia** (Postgres en el mismo servidor, sin datos de clientes): llaves públicas, sesiones, desafíos, planes, auditoría.
  El usuario `panel_app` solo puede **ejecutar** las funciones `panel_*`; no puede leer ni escribir tablas, ni crear nada.
* **Interfaz sin frameworks** y sin dependencias de terceros en el navegador (13 KB).

## Qué protege

| Activo | Por qué importa |
|---|---|
| **Llave de la API de Supabase** (token con alcance) | Con ella se crean/modifican proyectos de todos los clientes. Es lo más valioso. |
| Llaves de servicio de cada cliente | Pasan por el servidor un instante al operar; **nunca** se guardan ni llegan al navegador. |
| Base propia del panel | Sesiones, desafíos, planes y auditoría. No tiene datos de clientes. |
| Registro de auditoría | Es la prueba de qué se hizo y quién lo hizo. |

## Quién ataca (y desde dónde)

1. **Cualquiera en internet**: escaneo, fuerza bruta, fuzzing, inyecciones, abuso de recursos.
2. **Phishing**: una página falsa que imita al panel.
3. **Una página maliciosa abierta en tu celular** mientras tenés sesión (CSRF, clickjacking, XSS).
4. **Celular o sesión robada**.
5. **Repetición** (replay) de algo capturado (una firma, un desafío, un pedido).
6. **Dependencias comprometidas** (un paquete de npm con código malicioso).
7. **Filtración** de variables de entorno o de logs.
8. **Errores propios**: validación floja, ruta olvidada, condición de carrera.
9. **Otro servicio en el mismo servidor** que sea vulnerable.

## Decisiones de diseño (y por qué)

1. **Sin internet público: red privada (Tailscale).** El panel solo responde dentro de tu red privada. Desde afuera no hay puerta
   que escanear. Además cada pedido tiene que traer *tu* usuario de Tailscale (si no, siempre la misma respuesta 403, sin tocar la base).
2. **Sin contraseña: llaves de acceso (passkeys / WebAuthn).** Huella o rostro del celular. No hay clave que adivinar ni robar por
   phishing: la llave está atada a la dirección del panel. Se registran dos (celular + respaldo).
3. **Mirar es fácil, cambiar es difícil.** Con la sesión solo se **mira**. Para **cambiar** algo, cada operación exige una firma
   nueva de tu llave sobre *esa operación exacta* (como confirmar una transferencia). El servidor guarda el plan, te lo muestra y solo
   ejecuta lo firmado. Una cookie robada no sirve para hacer daño.
4. **Lista cerrada de acciones.** El panel solo sabe: listar, ver estado, crear cliente, actualizar cliente, cambiar módulos, instalar un componente y agregar o quitar organizaciones de su lista. **No existe**
   ninguna ruta para borrar proyectos, ejecutar SQL libre, ver llaves ni cambiar de organización. Lo que no existe no se puede explotar.
   Una prueba automática verifica que las únicas llamadas salientes sean las de la lista.
5. **Una organización de Supabase por cliente** (los proyectos son del cliente, que te invita). El panel solo opera las organizaciones de una **lista cerrada**: las de `PANEL_ORG_SLUGS` más las que agregues desde la pantalla Organizaciones (con tu firma, y solo si esa organización invitó de verdad a la cuenta del panel), aunque la cuenta pertenezca a otras. La cuenta de Supabase del panel es exclusiva (no es tu cuenta personal) y su llave puede ser clásica (práctica) o con alcance (más estricta): ver la guía de instalación.
6. **Estado en una base con operaciones atómicas** (desafíos de un solo uso, contadores de llave, límites, planes): cada operación
   crítica es una función de base de datos que se ejecuta de una sola vez.
7. **Auditoría encadenada** (cada registro lleva el hash del anterior), solo de agregar, con verificación visible en la pantalla.
8. **Avisos al celular** de cada ingreso, firma, error de seguridad y operación (ntfy u otro webhook).
9. **Botón de pánico**: cierra todas las sesiones y cancela todos los planes pendientes.
10. **Topes contra gastos**: máximo 5 clientes nuevos por día y tope de proyectos en la organización.
11. **Aislamiento**: el panel y las apps de clientes son sitios distintos y no comparten código.

## Controles por amenaza

| # | Amenaza | Controles |
|---|---|---|
| 1 | Internet sin credenciales | No es alcanzable (red privada); usuario de red exigido; límites de velocidad en la base; cuerpos ≤ 16 KB con largo declarado; JSON con profundidad limitada; validación por lista de permitidos; errores genéricos; sin CORS. |
| 2 | Phishing | Llave de acceso atada al dominio (rpID + origen verificados); además, el sitio falso no está dentro de tu red privada. |
| 3 | CSRF / XSS / clickjacking | Cookie `__Host-` `HttpOnly; Secure; SameSite=Strict`; verificación de `Origin` y `Sec-Fetch-Site`; encabezado propio; solo `application/json`; CSP sin scripts ni estilos en línea y con Trusted Types; la interfaz escribe solo con `textContent`; `frame-ancestors 'none'`. |
| 4 | Sesión / celular robado | Inactividad 15 min y tope de 8 h; la cookie queda ligada al navegador (User-Agent): si cambia, se revoca; firma de llave por operación; pánico; la app se cierra sola tras 5 min en segundo plano. |
| 5 | Repetición | Desafíos de un solo uso (2 min), consumidos atómicamente; contador de la llave que no puede retroceder; un plan se autoriza una vez y solo desde su sesión. |
| 6 | Dependencias | 2 dependencias de ejecución con versión exacta; `minimumReleaseAge` 3 días; sin scripts de instalación; `pnpm audit` en cada cambio; el servidor se empaqueta en un archivo y en producción no se instala nada. |
| 7 | Filtración de secretos | Secretos solo en un archivo `600`; redacción por **patrón y por valor exacto** en logs, auditoría y avisos; las llaves de clientes no se guardan; el servidor nunca devuelve llaves. |
| 8 | Errores propios | ≈550 pruebas de ataque automáticas (incluye Postgres real con conexiones simultáneas), análisis estático, revisión manual. |
| 9 | Otro servicio en el mismo servidor | Recomendación firme: **servidor aparte**. Si no, usuario propio, `systemd` con aislamiento y sin carpetas compartidas (ver instalación). |

## Raíz de confianza (lo que NO puede resolver el código)

Quien controle tu cuenta de **Tailscale**, **Supabase**, **GitHub** o **DigitalOcean**, o el propio servidor, controla el panel.
Por eso, antes de usarlo: llave de acceso o verificación en dos pasos en las cuatro cuentas, recuperación protegida, y nadie más con acceso.

## Cómo se instala una operación (ejemplo: "cliente nuevo")

1. Elegís nombre, correo del dueño y módulos. El servidor valida y arma un **plan** (lista de pasos): instala **solo los componentes** (Base, Abastecimiento, Mantenimiento) de los módulos elegidos.
2. Te muestra el resumen exacto y pide tu **firma** (huella/rostro).
3. Con la firma, el plan queda autorizado (30 min). La pantalla va pidiendo **un paso por vez**: crear proyecto → esperar → aplicar
   migraciones de esos componentes (una por paso) → secreto y funciones → cerrar registro público → dueño → módulos → verificar. Cada paso es corto y se
   puede reintentar sin duplicar nada.
4. Al final podés ver **una sola vez** la contraseña inicial del dueño. No se guarda: se calcula a partir de un secreto del servidor.

## Qué queda fuera (a propósito)

Borrar proyectos, SQL libre, ver/exportar llaves, publicar el sitio del cliente en Netlify, backups de los clientes. Cada cosa que se
agregue amplía lo que un atacante podría usar: se suma solo con pedido y con su propia revisión (ver "Central de control" en PENDIENTES).
