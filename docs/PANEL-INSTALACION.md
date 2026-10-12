# Instalar el panel de clientes — paso a paso

Está escrito para hacerse **de a un paso**, sin apuro, y sin saltear la lista de comprobación del final. Los comandos de la computadora
y del servidor los corrés vos; ante cualquier duda, frená y preguntá antes de seguir (sobre todo en los pasos marcados 🔒).

> **Antes de empezar, una decisión que cambia la seguridad:** el panel guarda la llave que puede crear y modificar proyectos de todos tus
> clientes. Conviene que viva en un **servidor chico aparte** (en DigitalOcean, el de 1 GB cuesta unos 6 USD por mes) y **no** en el
> servidor donde hoy están los manuales de la fábrica, que tiene un servicio abierto a internet. Si igual se usa el mismo, ver el final
> ("Si se comparte el servidor").

## Qué vas a tener al terminar

Una página que solo abre tu celular (con Tailscale prendido) y solo se desbloquea con tu huella o rostro, desde donde creás clientes,
los actualizás y cambiás sus módulos, con aviso al celular de cada cosa que pasa.

## Paso 0 — Cuentas y protección (🔒 no se saltea)

En **Tailscale, Supabase, GitHub y DigitalOcean**: activá la llave de acceso (passkey) o la verificación en dos pasos, guardá los códigos de
recuperación en un lugar seguro y revisá que no haya otras personas con acceso. Quien controle una de esas cuentas controla el panel.

## Paso 1 — Una cuenta de Supabase solo para el panel, y una organización por cliente

Cada cliente tiene su **propia cuenta y organización de Supabase** (los proyectos son suyos y los paga él). Vos entrás como invitado. Para que la llave del
panel no se mezcle con tus cosas personales, usá una **cuenta de Supabase aparte, solo para el panel** (por ejemplo `panel@tudominio.com`, con llave de acceso o 2FA).

Por cada cliente nuevo:

1. El cliente crea su cuenta de Supabase y su organización (plan Free o Pro, según lo que contrate).
2. Te pide que lo invites, o te invita él: tiene que agregar a la **cuenta del panel** como **Administrator** (no hace falta Owner) en su organización.
3. Anotás el identificador de esa organización (aparece en la dirección: `supabase.com/dashboard/org/<identificador>`).
4. En el panel: **Organizaciones → pegás el identificador → Agregar organización** y firmás con tu huella. El panel comprueba solo que esa organización de verdad invitó a la cuenta del
   panel (si no la ve, la rechaza). **El panel solo opera las organizaciones que figuran ahí**, aunque la cuenta del panel pertenezca a otras. Para cortar el acceso a un cliente:
   **Quitar** en esa misma pantalla (no borra nada en Supabase), o que él te saque del equipo. (Si preferís, también se pueden dejar fijas en `PANEL_ORG_SLUGS` dentro de
   `/etc/panel/panel.env`: esas no se pueden quitar desde la pantalla.)

Tu proyecto de Cremac y las demás cosas tuyas **no** se mezclan con esto.

## Paso 2 — La llave de Supabase del panel (🔒)

Entrá a Supabase **con la cuenta del panel** → perfil → **Access Tokens**. Hay dos formas, de menos a más estricta:

* **A. Llave "clásica" de esa cuenta (más práctica).** Alcanza a todas las organizaciones donde la cuenta del panel es miembro, o sea **solo las de tus clientes**
  (porque la cuenta es exclusiva del panel). No hay que cambiar la llave cada vez que se suma un cliente: alcanza con invitarlo y agregarlo a `PANEL_ORG_SLUGS`.
  Ponele **vencimiento** de 90 días si te lo permite.
* **B. Llave con alcance ("scoped") a organizaciones elegidas (más estricta).** Permisos: `Projects` (lectura) · `Organization Projects` (lectura y escritura) ·
  `Database` (lectura y escritura) · `Edge Functions` (lectura y escritura) · `Edge Function Secrets` (lectura y escritura) · `API Keys` (lectura) ·
  `API Key Secrets` (lectura) · `Auth Config` (lectura y escritura). **No se puede editar después**: cada cliente nuevo exige crear otra llave que incluya
  su organización y cambiarla en el servidor.

Recomendación: **A** mientras tengas pocos clientes y la cuenta del panel sea exclusiva y protegida; **B** si algún cliente grande lo exige.

Copiá la llave (empieza con `sbp_`) a tu gestor de contraseñas. **No** la pegues en chats ni en Git.

Comprobación de solo lectura (no cambia nada), desde tu computadora, en la carpeta `panel/`:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... PANEL_ORG_SLUGS=identificador1,identificador2 pnpm verificar-api
```

## Paso 3 — Tailscale

1. Creá la cuenta en tailscale.com (con una cuenta que tenga llave de acceso o 2FA) e instalá la app en tu **celular** y en tu **computadora**.
2. En el panel de administración de Tailscale → **DNS** → activá **HTTPS Certificates** (una sola vez).
3. En **Access controls (ACL)**, dejá que solo tus propios dispositivos puedan llegar al servidor del panel (el ejemplo por defecto "todos con todos" sirve si
   no invitaste a nadie más a tu red).

## Paso 4 — El servidor (🔒)

1. En DigitalOcean: **Create → Droplet**, Ubuntu 24.04, el plan de 1 GB, autenticación **solo por llave SSH** (sin contraseña de root). Nombre: `panel`.
2. En DigitalOcean → **Networking → Firewalls**: creá un firewall que **no permita ninguna entrada** (ni siquiera SSH) y asignáselo al servidor. Para entrar
   usarás la **Consola web** de DigitalOcean o Tailscale SSH.
3. Entrá por la Consola web y actualizá todo:

```bash
apt update && apt -y upgrade
apt -y install unattended-upgrades postgresql ufw
```

4. Instalá Tailscale (es el método oficial del fabricante) y conectalo a tu cuenta:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh
```

Abrí el enlace que muestra, aprobá el dispositivo, y comprobá que el servidor aparece en tu app de Tailscale. **Recién entonces** cerrá todo lo demás:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw enable
ufw status verbose
```

5. Instalá Node 24 desde la página oficial verificando la huella:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.14.1/node-v24.14.1-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/dist/v24.14.1/SHASUMS256.txt
grep node-v24.14.1-linux-x64.tar.xz SHASUMS256.txt | sha256sum -c -
mkdir -p /opt/node && tar -xJf node-v24.14.1-linux-x64.tar.xz -C /opt/node --strip-components=1
ln -sf /opt/node/bin/node /usr/bin/node
node --version
```

Tiene que decir `OK` en la verificación y `v24.14.1` al final.

## Paso 5 — La base del panel

Copiá `panel/db/instalar.sql` y `panel/db/schema.sql` al servidor (con `scp` por la red de Tailscale, o pegándolos con la Consola). Generá los secretos **en tu
computadora** (no en el servidor):

```bash
node scripts/generar-secretos.mjs
```

Guardá los cuatro valores en tu gestor de contraseñas. Después, en el servidor:

```bash
runuser -u postgres -- createdb panel
runuser -u postgres -- psql -v clave="'PEGA-ACA-LA-CLAVE-DE-LA-BASE'" -f instalar.sql panel
runuser -u postgres -- psql -f schema.sql panel
```

## Paso 6 — Armar y copiar el panel (desde tu computadora)

```bash
cd panel
pnpm install --frozen-lockfile
pnpm test          # tienen que pasar todas
pnpm build
cat dist/panel.mjs.sha256
```

Copiá `dist/panel.mjs`, la carpeta `dist/web` (como `web`), `desplegar/respaldo.sh`, `desplegar/panel.service`, `desplegar/panel-respaldo.service` y
`desplegar/panel-respaldo.timer` al servidor, y comprobá que la huella es la misma:

```bash
mkdir -p /opt/panel /etc/panel
cp panel.mjs respaldo.sh /opt/panel/ && cp -r web /opt/panel/web
sha256sum /opt/panel/panel.mjs        # tiene que coincidir con la de tu computadora
chmod +x /opt/panel/respaldo.sh
useradd --system --home-dir /opt/panel --shell /usr/sbin/nologin panel
chown -R root:root /opt/panel && chmod -R go-w /opt/panel
chmod 700 /etc/panel
```

## Paso 7 — La configuración (🔒)

Averiguá el nombre de tu servidor en la red privada y activá el acceso HTTPS:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3100
tailscale serve status
```

Verás una dirección tipo `https://panel.tu-red.ts.net`: esa es `PANEL_ORIGEN`. Tu `PANEL_USUARIO_RED` es el correo con el que entrás a Tailscale.

Creá `/etc/panel/panel.env` a partir de `desplegar/panel.env.ejemplo` (con los secretos del paso 5 y la llave del paso 2) y protegelo:

```bash
nano /etc/panel/panel.env
chown root:root /etc/panel/panel.env && chmod 600 /etc/panel/panel.env
```

## Paso 8 — Encenderlo

```bash
cp panel.service panel-respaldo.service panel-respaldo.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now panel panel-respaldo.timer
systemctl status panel --no-pager
journalctl -u panel -n 30 --no-pager
```

Tiene que decir `active (running)` y en el registro aparece `panel_iniciado`. Si dice `no_arranca`, el mensaje nombra la variable que está mal (nunca su valor).

## Paso 9 — Registrar tus llaves de acceso

Con Tailscale prendido en el celular, abrí la dirección del paso 7. Escribí el **código de alta** (`PANEL_CODIGO_ALTA`) y registrá la llave con tu huella.
Dentro de los **15 minutos** registrá también una **llave de respaldo** (otro celular, o una llave USB/NFC). Pasado ese tiempo el alta se cierra sola.

Instalá la app **ntfy**, suscribite al tema secreto y poné la dirección en `PANEL_ALERTA_URL` (y reiniciá: `systemctl restart panel`): vas a recibir un aviso de cada ingreso,
firma y operación.

## Paso 10 — Lista de comprobación (no se saltea)

Marcá cada una:

- [ ] **Desde afuera no existe**: con el celular **sin** Tailscale (datos móviles), la dirección del panel no carga.
- [ ] En el servidor, `ss -tlnp` muestra el panel y la base **solo en 127.0.0.1** (no en `0.0.0.0`).
- [ ] `ufw status` dice `active` y solo permite `tailscale0`; el firewall de DigitalOcean no tiene reglas de entrada.
- [ ] `systemd-analyze security panel.service` da una puntuación baja (el objetivo es "OK" o "MEDIUM" o mejor).
- [ ] `ls -l /etc/panel/panel.env` dice `-rw------- root root`.
- [ ] Ingresás con la huella; con la sesión abierta, **crear un cliente exige volver a tocar la huella**.
- [ ] Entrás a **Auditoría** y dice "Cadena íntegra".
- [ ] Probás el **botón de pánico** y la sesión se cierra en el celular.
- [ ] Llega el aviso de ntfy cuando ingresás.
- [ ] Creás un **cliente de prueba** (organización "Clientes", nombre "Prueba panel"), verificás que quedó con las migraciones de los componentes que elegiste, las funciones, el registro público
  cerrado y el dueño (probá también con un cliente que solo contrate Tareas, que debe quedar solo con la Base, y ampliarlo después con "Instalar componente"); ahí se comprueban los permisos de escritura de la llave. Después lo borrás **a mano** desde Supabase (el panel no borra proyectos).
- [ ] Mostrás la contraseña inicial del dueño de prueba, la copiás y tocás "Ya la copié": ya no se puede volver a ver.

## Uso diario

* **Cliente nuevo**: botón "＋ Nuevo cliente" → completás (elegís el **plan**: Plan 1 o Plan 2, y debajo se lee qué módulos incluye; los planes 3 y 4 figuran como "Próximamente" y no se pueden elegir. No se eligen módulos sueltos: lo que el cliente no use lo apaga él en Configuración → Módulos. Para un caso especial, "Cambiar módulos" del cliente o `pnpm cliente`) → "Revisar plan" → revisás → "Firmar con tu huella y ejecutar".
* **Actualizar** (cuando cambia la plantilla): entrás al cliente → "Actualizar este cliente".
* **Módulos**: entrás al cliente → tildás/destildás → "Aplicar cambios". Un módulo cuyo componente no está instalado aparece deshabilitado.
* **Instalar un componente** (por ejemplo, Mantenimiento cuando el cliente lo contrata): entrás al cliente → "Instalar Mantenimiento" → revisás el plan → firmás. No toca los datos que ya tiene; sus módulos quedan apagados hasta que los activás con "Aplicar cambios".
* El panel solo opera clientes que él mismo instaló. Un cliente que ya existía (por ejemplo Cremac) se adopta con el comando de la computadora (`pnpm cliente actualizar --marcar-hasta`).

## Mantenimiento

* **Actualizar el panel**: en tu computadora `pnpm test && pnpm build`, copiás `dist/panel.mjs` y `dist/web`, verificás la huella y `systemctl restart panel`.
* **Rotar la llave de Supabase** (cada 90 días o si sospechás algo): creás una nueva (paso 2), la ponés en `/etc/panel/panel.env`, `systemctl restart panel`, y borrás la vieja en Supabase.
* **Perdiste el celular**: (1) en Tailscale, quitá el dispositivo; (2) en `/etc/panel/panel.env` cambiá `PANEL_CODIGO_ALTA` por uno nuevo y `systemctl restart panel`;
  (3) desde el celular nuevo registrás llaves con el código nuevo: **reemplaza todas las anteriores y cierra todas las sesiones**.
* **Algo raro**: botón de pánico; después `journalctl -u panel -n 200 --no-pager` y la pantalla de Auditoría. Si dudás de la llave de Supabase, borrala en Supabase.
* **Respaldos**: cada noche, en `/var/backups/panel` (14 días). Restaurar: `runuser -u postgres -- pg_restore --clean -d panel archivo.dump`.
* **Actualizaciones del sistema**: `unattended-upgrades` instala las de seguridad solas; una vez por mes entrá y corré `apt update && apt upgrade`.

## Si se comparte el servidor (así se hizo el 2026-10-11, en el servidor de los manuales)

La guía de arriba supone un servidor **solo para el panel**. Si va en un servidor que ya tiene un servicio público (por ejemplo, el de los manuales), estas son las diferencias, que se probaron en el servidor real:

* **No apliques el cortafuegos "nada de entrada salvo Tailscale"** (paso 4): cerraría el 80 y el 443 y se caería el otro servicio. Dejá lo que ya está abierto y agregá solo `ufw allow in on tailscale0`. Tampoco crees el firewall externo de DigitalOcean que bloquea todo.
* **No hagas `apt upgrade` completo ni reinstales Node** (paso 3 y 5): puede reiniciar el otro servicio o pisarle su Node. Instalá solo lo que falta (`postgresql` y Tailscale) con `NEEDRESTART_MODE=l` para que no reinicie nada, y usá el Node que ya está (editá `ExecStart` de `panel.service` con su ruta, por ejemplo `/usr/local/bin/node`).
* **Ajustá PostgreSQL a poca memoria** (servidor de 1 GB): en `/etc/postgresql/16/main/conf.d/panel.conf`, `listen_addresses = '127.0.0.1'`, `max_connections = 20`, `shared_buffers = 32MB`, `work_mem = 2MB`, `maintenance_work_mem = 16MB`. El servicio ya tiene `MemoryMax=400M`.
* **Generá los secretos en el propio servidor**, sin mostrarlos, y borrá después los archivos temporales con `shred -u`.
* **El cerrojo (`desplegar/panel-cerrojo.service`) es obligatorio al compartir**: sin él, quien ejecute código como otro usuario del servidor (por ejemplo, el del servicio público) puede hablarle al panel por 127.0.0.1 **falsificando el encabezado de Tailscale** y saltarse la puerta de red (se comprobó: HTTP 200). Con el cerrojo, solo `root` (el proceso de Tailscale) puede conectarse al puerto del panel, y solo los usuarios `panel` y `postgres` a la base. Se instala con `cp panel-cerrojo.service /etc/systemd/system/ && systemctl enable --now panel-cerrojo`.
* Pruebas que se hicieron (repetilas): escaneo de puertos desde afuera (solo 22, 80 y 443, como antes); el otro usuario no puede leer `/etc/panel`; ese usuario falsificando el encabezado ya no logra conectarse; `systemd-analyze security panel.service` da "1.1 OK"; el respaldo diario funciona; el otro servicio sigue respondiendo.
* **Sacá de `/root/.ssh/authorized_keys` la llave que se usó para instalar** al terminar.

Un riesgo que **no** desaparece: si alguien llegara a ser administrador (root) del servidor, ve todo. Con un servidor aparte ese riesgo no existe; compartirlo ahorra el costo del segundo servidor.
