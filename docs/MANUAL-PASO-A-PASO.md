# Manual paso a paso

Este manual es para **quien vende e instala la aplicación** (no para el cliente). Está escrito sin jerga, con los
pasos en el orden en que se hacen. Cuando algo es técnico, se explica con palabras comunes.

**Cómo usarlo:** si es tu primera vez, leé los capítulos 1 a 3 enteros. Después, para instalar un cliente, andá directo al
capítulo 4 y seguilo punto por punto. Los demás son de consulta.

| Capítulo | Para qué |
|---|---|
| 1. Qué es lo que vendés | Entender las piezas |
| 2. Qué necesitás antes de empezar | Cuentas y programas (una sola vez) |
| 3. Decisiones antes de vender | Cuenta de Supabase, plan, contraseñas |
| **4. Instalar un cliente nuevo** | **El paso a paso principal** |
| **4B. Instalar un cliente en SU PROPIA cuenta** | **Cuando el cliente quiere que la base de datos (y, si quiere, el sitio) sea suyo** |
| 5. Módulos y componentes | Qué se vende por separado, qué se instala y cómo se activa |
| 6. Usuarios y permisos | Quién puede hacer qué |
| 7. El asistente de configuración inicial | Lo que ve el cliente la primera vez |
| 8. El día a día | Actualizar, cambiar módulos, resolver pedidos del cliente |
| 9. Si algo sale mal | Problemas comunes y qué hacer |
| 10. Pasar una instalación que ya existe (Cremac) | Con cuidado |
| 11. Lo que todavía no existe | Para no prometer de más |
| 12. Dónde está cada cosa | Mapa de la carpeta del proyecto |
| 13. Glosario | Qué significa cada palabra |
| 14. Lista de verificación de entrega | Para ir tildando |

---

## 1. Qué es lo que vendés

Pensalo como **un edificio de oficinas**:

- **El edificio es la aplicación.** Es siempre la misma para todos los clientes: el mismo código.
- **Los pisos son los módulos** (Proveedores, Comisionistas, Envíos, Depósito, Mantenimiento, Tareas). Cada cliente compra algunos pisos,
  y los que no compró **no existen en su edificio**: no están cerrados con llave, directamente no están construidos. Por dentro, los pisos se agrupan en
  tres **componentes** (Base, Abastecimiento y Mantenimiento); a cada cliente se le instalan solo los componentes de lo que contrata (capítulo 5).
- **Cada cliente tiene su propia base de datos**, que es su "depósito" privado donde viven sus datos. Nadie ve los datos de otro.

Las piezas concretas que intervienen son cinco:

| Pieza | Para qué sirve | Dónde vive |
|---|---|---|
| **La aplicación** (lo que ve el cliente en el navegador) | Las pantallas | Un sitio en **Netlify**, uno por cliente |
| **Supabase** | Guarda los datos, los usuarios y los permisos | Un **proyecto** por cliente, en la cuenta del cliente |
| **GitHub** | Guarda el código de la aplicación | Un solo repositorio, `gestion-empresarial` |
| **Panel de administración** *(opcional: es lo mismo que los comandos, pero desde el celular)* | Crear clientes, actualizarlos, cambiar sus módulos e instalarles componentes | Un servidor propio, detrás de Tailscale. Ver [PANEL-INSTALACION.md](PANEL-INSTALACION.md) |
| **Servidor de archivos** *(opcional, todavía no conectado a la app)* | Manuales y archivos pesados | Tu servidor de Digital Ocean |

**Lo importante:** el código es uno solo. Lo que cambia entre clientes son (1) su proyecto de Supabase, (2) su sitio en
Netlify, y (3) su **licencia de módulos** y los componentes instalados. Por eso instalar un cliente nuevo es repetir siempre los mismos pasos.

> **Dos formas de hacer lo mismo.** En este manual los pasos se hacen con comandos en tu computadora (`pnpm cliente ...`). El **panel de administración**
> hace lo mismo desde el celular, con firma de huella en cada operación. Cuando el panel esté instalado, los pasos del capítulo 4 que crean el proyecto, instalan la base,
> definen los módulos y cierran el registro público se reemplazan por *Nuevo cliente* en el panel (que además muestra los "datos para publicar la app"); el resto
> (publicar en Netlify, probar, entregar) sigue igual.

---

## 2. Qué necesitás antes de empezar (una sola vez)

### 2.1 Cuentas

| Cuenta | Para qué | Ya la tenés |
|---|---|---|
| **GitHub** (github.com) | El código | Sí |
| **Supabase** (supabase.com) | Las bases de datos de los clientes | Sí |
| **Netlify** (netlify.com) | Publicar la aplicación de cada cliente | Sí |

### 2.2 Programas en tu PC

| Programa | Para qué | Cómo comprobar que está |
|---|---|---|
| **Node.js 24** | Hace funcionar los comandos | `node -v` debe mostrar `v24...` |
| **pnpm** | Instala las librerías del proyecto | `pnpm -v` debe mostrar un número |
| **Git** | Guardar y subir el código | `git --version` |

Para comprobar, abrí la terminal de Git (la que dice `MINGW64` arriba), escribí el comando y apretá Enter.

### 2.3 Preparar el proyecto

1. **Abrí la terminal de Git y pasate a la carpeta del proyecto:**

```bash
cd ~/OneDrive/Desktop/"Gestion empresarial"
```

2. **Instalá las librerías** (solo la primera vez, o si te lo pido):

```bash
pnpm install
```

3. **Dejá la llave de tu cuenta de Supabase.** Es una sola vez. El instalador habla directo con Supabase, sin programas extra:

   1. Entrá a https://supabase.com/dashboard/account/tokens y tocá **Generate new token** (de nombre, por ejemplo, `cliente`). Copiala: se muestra una sola vez.
   2. Corré este comando. La primera vez te avisa que falta la llave y deja preparado el archivo `clientes/cuenta-supabase.env.local` (privado: Git lo ignora):

```bash
pnpm cliente organizaciones
```

   3. Abrí ese archivo, pegá la llave después del `=` de la línea `SUPABASE_ACCESS_TOKEN=` (sin comillas ni espacios) y guardá.
   4. Volvé a correr el mismo comando: tiene que mostrar las organizaciones que ve tu cuenta.

   Si la llave vence o la revocás, repetí los pasos 1 y 3 con una nueva.

4. **Comprobá que todo está bien.** Este comando muestra la ayuda de los comandos del instalador; si ves el texto, está listo:

```bash
pnpm cliente
```

> **Si algo de esto falla:** copiá el mensaje completo y consultame. No sigas con el capítulo 4 hasta que `pnpm cliente`
> muestre la ayuda.

---

## 3. Decisiones antes de vender (pensalas una vez)

### 3.1 ¿En qué cuenta de Supabase vive el cliente?

| | En tu cuenta | En la cuenta del cliente *(el camino que se vende)* |
|---|---|---|
| De quién son los datos | Viven en tu cuenta | Son claramente de él |
| Quién paga Supabase | Vos | Él, con su tarjeta |
| Límite del plan gratis (2 proyectos por cuenta) | Se te acaba rápido | Cada cliente tiene los suyos |
| Si dejás de trabajar con él | Hay que mudar todo | Se queda con todo funcionando |

**Si elegís la cuenta del cliente**, antes de instalar:

1. El cliente crea su cuenta en supabase.com y una **organización** con el nombre de su empresa.
2. Te invita a esa organización con tu correo, con rol de administrador (el que permita crear proyectos):
   *Organization → Team → Invite*.
3. Averiguás el identificador de su organización. En la terminal, en la carpeta del proyecto:

```bash
pnpm cliente organizaciones
```

   Aparecen todas las organizaciones a las que tenés acceso, cada una con su identificador. Anotá el del cliente.
4. Al instalar (capítulo 4) vas a sumar `--org IDENTIFICADOR` al comando.

> Dependés de que él te mantenga como miembro. Si te saca de su organización, no podés actualizar ni cambiar módulos.
> Conviene dejarlo acordado.
>
> **El paso a paso completo de este camino está en el capítulo 4B.**

### 3.2 El plan de Supabase

- **Requisito para vender:** cada cliente va en **su propia cuenta (organización) de Supabase, con el plan Pro pagado por él**, y te invita como administrador.
  Así los datos son suyos, el costo es suyo y vos no cargás con cada base.
- El plan **gratis** permite **2 proyectos activos por cuenta** (hoy tu cuenta tiene el de Cremac y uno de pruebas), los proyectos **se pausan solos si pasan unos
  días sin uso** y **no tienen copias de seguridad restaurables**. Por eso no sirve para un cliente que usa la aplicación todos los días.
  **Confirmá precios y condiciones vigentes en supabase.com/pricing.**

### 3.3 Las contraseñas (un hueco que hay que conocer)

**La aplicación todavía NO tiene "cambiar mi contraseña" ni "olvidé mi contraseña".** Consecuencias:

- Al instalar, el sistema crea al dueño con una contraseña inicial aleatoria. **Esa contraseña no la puede cambiar él
  mismo desde la aplicación.**
- Si un usuario se olvida la suya, **no puede recuperarla solo.**
- Lo que sí existe: **un dueño puede resetear la contraseña de otro usuario** (incluso de otro dueño) desde
  *Configuración → General → Usuarios → Editar → 🔑 Contraseña*. Un dueño **no puede** resetear la suya propia.
- Lo que **no** sirve: el panel de Supabase. Aunque ahí hay opciones para usuarios, el correo de recuperación llevaría a una
  pantalla que la aplicación no tiene.

**Qué hacer mientras tanto:** al instalar, dejá **dos dueños** (por ejemplo, el cliente y una persona de su confianza), para
que uno pueda resetear al otro. Y avisale al cliente que la contraseña inicial es la que usa hasta que se arme esa función.

> **Recomendación fuerte:** construir "cambiar mi contraseña" y "olvidé mi contraseña" **antes de vender**, porque sin eso
> el cliente depende de vos para algo básico. Para "olvidé mi contraseña" hay que configurar el envío de correos en
> Supabase, y los correos que trae por defecto tienen límites estrictos.

### 3.4 Qué módulos vende cada cliente

Decidilo con él antes de instalar (capítulo 5 explica cada uno). Recordá que **Envíos necesita Proveedores**.

---

## 4. Instalar un cliente nuevo (paso a paso)

**Tiempo total:** entre 20 y 40 minutos, casi todo esperando.

### Paso 1. Reuní los datos

Anotá estos tres datos:

1. **Nombre de la empresa**, por ejemplo `Metalúrgica Pérez SA`.
2. **Correo del dueño**, por ejemplo `juan@metalurgicaperez.com`. Con ese correo va a entrar.
3. **Módulos que contrata**, por ejemplo `proveedores,deposito`. Los nombres exactos son:
   `proveedores`, `comisionistas`, `envios`, `deposito`, `mantenimiento`, `tareas` (o `todos`). Solo se le instalan los componentes de esos módulos (capítulo 5).

Y, si va en la cuenta del cliente, el **identificador de su organización** (capítulo 3.1).

### Paso 2. Abrí la terminal en la carpeta del proyecto

Terminal de Git (`MINGW64`), y:

```bash
cd ~/OneDrive/Desktop/"Gestion empresarial"
```

### Paso 3. Ejecutá el instalador

Reemplazá los datos de ejemplo por los reales. **Es un solo comando, en una sola línea:**

```bash
pnpm cliente nuevo --nombre "Metalúrgica Pérez SA" --email juan@metalurgicaperez.com --modulos proveedores,deposito
```

Si va en la cuenta del cliente, sumá la organización al final:

```bash
pnpm cliente nuevo --nombre "Metalúrgica Pérez SA" --email juan@metalurgicaperez.com --modulos proveedores,deposito --org IDENTIFICADOR-DE-LA-ORGANIZACION
```

**Qué vas a ver** (tarda entre 5 y 15 minutos; no cierres la terminal):

1. `▶ Creando el proyecto "metalurgica-perez-sa" en Supabase`
2. `▶ Esperando que el proyecto esté listo` *(la parte más lenta)*
3. `▶ Aplicando la base de datos`, con una lista de archivos que se van instalando
4. `▶ Publicando las funciones del servidor`
5. `▶ Creando al primer dueño`
6. `▶ Definiendo los módulos del cliente`
7. Un cuadro final que dice `✔ Listo: Metalúrgica Pérez SA`, con el identificador del proyecto y el nombre del archivo
   privado del cliente.

**Qué hace por dentro:** crea el proyecto, instala la base de datos vacía (solo los componentes de los módulos que contrata), publica las funciones de crear/resetear/eliminar
usuarios, crea al dueño con una contraseña aleatoria, y define la licencia de módulos.

**Si el comando se detiene con un mensaje que empieza con `✖`:** leélo, porque dice qué falta (por ejemplo, "Falta --modulos"
o "envios necesita proveedores"). No crea nada si los datos están mal. Ver el capítulo 9.

### Paso 4. Guardá el archivo privado del cliente

El instalador crea el archivo `clientes/metalurgica-perez-sa.env.local`. Es **privado**: no se sube a GitHub. Contiene:

| Línea | Qué es | ¿A quién se la das? |
|---|---|---|
| `SUPABASE_PROJECT_REF` | El **identificador** del proyecto (unas 20 letras) | Es el dato que usás en los comandos |
| `VITE_SUPABASE_URL` | La dirección del proyecto | Va a Netlify |
| `VITE_SUPABASE_ANON_KEY` | Clave pública | Va a Netlify |
| `SUPABASE_SECRET_KEY` | **Clave secreta de servicio** | **A nadie. Nunca va a Netlify.** |
| `SUPABASE_DB_PASSWORD` | Contraseña de la base | **A nadie.** |
| `PRIMER_DUENO_EMAIL` | Correo del dueño | Al cliente |
| `PRIMER_DUENO_CLAVE_INICIAL` | Contraseña inicial del dueño | Al cliente (ver capítulo 3.3) |

> **Hacé una copia de este archivo en un lugar seguro** (un gestor de contraseñas, por ejemplo). Existe solo en tu PC.
> Si lo perdés, las claves se pueden volver a ver en el panel de Supabase, pero la contraseña inicial del dueño no.

### Paso 5. Cerrá el registro público en Supabase

Sin esto, cualquiera que conozca la dirección del proyecto podría crearse una cuenta (quedaría sin permisos, pero conviene cerrarlo).

1. Entrá a **supabase.com**, y abrí el proyecto del cliente (se llama como la empresa, en minúsculas y con guiones).
2. En el menú de la izquierda: **Authentication**.
3. Entrá a **Sign In / Providers** (en algunas versiones se llama **Providers**).
4. Buscá la opción **"Allow new users to sign up"** y **apagala**. Guardá los cambios.

> Los nombres de los botones de Supabase pueden cambiar con el tiempo. Lo que buscás es la opción que permite o impide
> que la gente se registre sola.
>
> **No hace falta fiarse de la memoria:** el instalador (`pnpm cliente nuevo` y `pnpm cliente actualizar`) comprueba de verdad si el
> registro sigue abierto y, si lo está, escribe un aviso con `⚠ ATENCIÓN` al terminar. Si dice `✔ El registro público de usuarios está
> cerrado`, ya está.

### Paso 6. Publicá la aplicación en Netlify

1. Entrá a **netlify.com**, tu cuenta.
2. Tocá **Add new site → Import an existing project**.
3. Elegí **GitHub** y autorizá si te lo pide. Buscá el repositorio **`gestion-empresarial`** y elegilo.
4. Completá la configuración:

| Campo | Qué poner |
|---|---|
| Branch to deploy | `main` |
| Build command | `pnpm build` |
| Publish directory | `dist` |

5. Antes de tocar **Deploy**, abrí **Add environment variables** (o, si ya se publicó, *Site configuration → Environment variables*)
   y creá **estas dos** variables, copiando los valores del archivo del cliente:

| Nombre (exacto) | Valor |
|---|---|
| `VITE_SUPABASE_URL` | el de la línea `VITE_SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | el de la línea `VITE_SUPABASE_ANON_KEY` |

   **No** cargues ninguna otra.
6. Tocá **Deploy**. Espera unos minutos, hasta que diga **Published**.
7. Netlify le asigna una dirección del tipo `algo-aleatorio.netlify.app`. Podés cambiarla en *Site configuration → Change site name*,
   o conectar un dominio propio del cliente más adelante.

### Paso 7. Decile a Supabase cuál es la dirección

1. Volvé al proyecto del cliente en Supabase → **Authentication → URL Configuration**.
2. En **Site URL**, pegá la dirección completa de Netlify, con `https://` adelante.
3. Guardá.

### Paso 8. Probá vos antes que el cliente

1. Abrí la dirección de Netlify en el navegador.
2. Tenés que ver la pantalla de ingreso con **el nombre de la empresa**.
3. Entrá con el correo del dueño y la contraseña inicial del archivo.
4. **Tiene que abrirse solo** el asistente de **Configuración inicial** (capítulo 7).
5. Recorré las pestañas de arriba: tienen que aparecer **solo los módulos que contrató**.

Si algo no se ve como esperás, andá al capítulo 9.

### Paso 9. Dejá un segundo dueño (recomendado)

Por lo explicado en el capítulo 3.3:

1. Dentro de la aplicación, como dueño: *Configuración → General → Usuarios → + Nuevo usuario*.
2. Creá la persona de confianza, con su correo y una contraseña.
3. Entrá a su ficha (*Editar*) y tocá **👑 Agregar como dueño**.

### Paso 10. Entregá al cliente

Pasale por un medio seguro:

- La **dirección** de la aplicación.
- El **correo** del dueño.
- La **contraseña inicial** (ver capítulo 3.3).

Y explicale que apenas entre se abre una guía para dejar todo configurado. **Después de la entrega, tildá la lista del
capítulo 14.**

---

## 4B. Instalar un cliente en SU PROPIA cuenta

Es el mismo procedimiento del capítulo 4, con **tres cambios**:

1. **Antes de instalar**, el cliente prepara su cuenta de Supabase y te invita.
2. **Al instalar**, el comando lleva una opción más: `--org`.
3. **Decidís dónde va el sitio publicado** (Netlify): en tu cuenta o en la suya.

Todo lo demás (cerrar el registro, publicar, probar, entregar) es igual.

### Quién hace qué

| | Lo hace el cliente | Lo hacés vos |
|---|---|---|
| Crear su cuenta y su organización en Supabase | ✅ | |
| Invitarte a esa organización | ✅ | |
| Aceptar la invitación | | ✅ |
| Averiguar el identificador de su organización | | ✅ |
| Instalar la aplicación con `--org` | | ✅ |
| Cerrar el registro, publicar y probar | | ✅ (igual que el capítulo 4) |
| Pagar Supabase (si hace falta un plan pago) | ✅ | |

### Parte A. Lo que hace el cliente

Podés mandarle este mensaje tal cual (cambiá lo que haga falta):

> Hola. Para instalarte el sistema en tu propia cuenta necesito que hagas esto, son 10 minutos:
> 1. Entrá a **supabase.com** y creá una cuenta (podés usar tu correo o tu cuenta de GitHub).
> 2. Creá una **organización** con el nombre de tu empresa (te la pide al registrarte; si no, está en el selector de organizaciones, arriba a la izquierda).
> 3. Dentro de esa organización, entrá a **Team → Invite member** (invitar miembro). Escribí **este correo: ____________** y elegí el rol **Administrator**. Enviá la invitación.
> 4. Avisame cuando esté hecho.

Los nombres de los botones pueden cambiar con el tiempo: lo que se busca es **invitar a una persona a la organización, con un rol que le permita crear proyectos**.

### Parte B. Lo que hacés vos

**1. Aceptá la invitación.** Te llega un correo de Supabase; tocá el botón para aceptarla (con el mismo correo con el que entraste a Supabase desde la terminal).

**2. Averiguá el identificador de su organización.** En la terminal, en la carpeta del proyecto:

```bash
cd ~/OneDrive/Desktop/"Gestion empresarial"
```

```bash
pnpm cliente organizaciones
```

Aparecen **todas** las organizaciones a las que tenés acceso: la tuya y la del cliente. Reconocés la suya por el nombre. Copiá su identificador (una palabra de unas 20 letras). Si **no aparece**, ver "Si algo falla" más abajo.

**3. Instalá.** Es el mismo comando del capítulo 4, con `--org` al final:

```bash
pnpm cliente nuevo --nombre "Nombre del Cliente SA" --email dueno@cliente.com --modulos proveedores,deposito --org IDENTIFICADOR-DE-SU-ORGANIZACION
```

**4. Comprobá que quedó en su cuenta.** Entrá a supabase.com, abrí el selector de organizaciones (arriba a la izquierda) y elegí la del cliente: tiene que aparecer el proyecto nuevo. Si aparece en la tuya, ver "Si algo falla".

**5. Seguí con el capítulo 4 desde el Paso 4** (guardar el archivo privado, cerrar el registro público, publicar, poner la dirección en Supabase, probar y entregar). El proyecto que abrís en Supabase para esos pasos es el que está **dentro de la organización del cliente**.

**Si usás el panel en vez de los comandos:** el cliente no te invita a vos sino a la **cuenta de Supabase del panel** (una cuenta aparte, solo para eso), como Administrator. Después, en el panel:
*Organizaciones → Agregar* (se firma con la huella) y listo: desde ahí *Nuevo cliente* permite elegir esa organización. Paso a paso en [PANEL-INSTALACION.md](PANEL-INSTALACION.md).

### Parte C. ¿Dónde va el sitio publicado (Netlify)?

Es una decisión independiente de la base de datos. Tres caminos:

| Camino | Cómo es | Conviene cuando |
|---|---|---|
| **1. En tu cuenta de Netlify** | Lo publicás vos, como en el capítulo 4. Se actualiza solo cuando subís cambios | Es lo más simple. Recomendado |
| **2. En la cuenta de Netlify del cliente** | El sitio está en su equipo; vos lo administrás como miembro | El cliente quiere que todo figure a su nombre |
| **3. Que el cliente tenga el código** | Se le da acceso al repositorio | **No lo recomiendo:** el repositorio es tu producto y lo recibiría completo |

**Si elegís el camino 2:**

*El cliente:*
1. Entra a **netlify.com**, crea una cuenta (se crea con ella un **equipo**, o "team").
2. En la configuración del equipo (*Team settings → Members*), te invita con tu correo y un rol que permita crear sitios.

*Vos:*
1. Aceptás la invitación.
2. En Netlify, arriba a la izquierda, elegí el **equipo del cliente** en el selector de equipos.
3. Creá el sitio como en el Paso 6 del capítulo 4 (*Add new site → Import an existing project → GitHub → repositorio `gestion-empresarial`*), con las mismas dos variables.

Tener en cuenta: el sitio queda conectado a **tu** cuenta de GitHub. Si algún día te sacan del equipo, no podés actualizarlo.

### Parte D. Qué dejar acordado con el cliente

Conviene hablarlo **antes** de instalar, y dejarlo por escrito:

- [ ] **Vos seguís como miembro** de su organización mientras trabajen juntos (sin eso no podés actualizar ni cambiar módulos).
- [ ] **Quién paga Supabase.** El plan gratis no tiene copias de seguridad restaurables y los proyectos se pausan si no se usan: para una empresa que lo usa todos los días, conviene un plan pago (verificá precios y condiciones vigentes en supabase.com/pricing). Se contrata desde la organización del cliente, con su tarjeta.
- [ ] **Quién guarda las claves.** El archivo `clientes/....env.local` que deja el instalador queda en tu PC y tiene las claves de **su** proyecto. Es información suya: guardalo bien.
- [ ] **Qué pasa si dejan de trabajar juntos.** La base de datos ya es suya y sigue funcionando. Lo que cambia: dejás de poder actualizarla, y el sitio publicado, si estaba en tu Netlify, hay que pasarlo a su cuenta.

### Si algo falla

| Qué pasa | Qué hacer |
|---|---|
| `pnpm cliente organizaciones` no muestra la organización del cliente | Casi seguro falta **aceptar la invitación** (revisá el correo, también en no deseados), o la llave que usás es de **otra cuenta** de Supabase. Generá la llave desde la cuenta con la que aceptaste la invitación (https://supabase.com/dashboard/account/tokens) y pegala en `clientes/cuenta-supabase.env.local` |
| El comando dice que no tenés permiso para crear el proyecto | Tu rol en su organización es demasiado bajo. Pedile que te suba a **Administrator** (o Owner) |
| El proyecto se creó en **tu** cuenta y no en la suya | Faltó `--org`, o el identificador estaba mal. Borrá ese proyecto desde el panel de Supabase y repetí el comando con `--org` |
| Supabase pide una tarjeta | Es porque la organización del cliente necesita un plan pago para ese proyecto. La carga él |
| El cliente no encuentra "Team" o "Invite" | Los nombres cambian: buscá en el menú de la organización la opción de **miembros** o **invitar personas** |

---

## 5. Módulos y componentes

Un módulo es una parte de la aplicación que se vende por separado. Por dentro, los módulos se agrupan en **componentes**: cada cliente recibe solo los
componentes de los módulos que contrata, y lo que no contrata **no existe** en su base de datos.

### 5.1 Los módulos que existen hoy

| Módulo (nombre exacto) | Qué incluye | Componente | Necesita |
|---|---|---|---|
| `proveedores` | Directorio de proveedores, con sus contactos y rubros | Abastecimiento | — |
| `comisionistas` | Directorio de comisionistas, con campos personalizables | Abastecimiento | — |
| `envios` | Rótulos de envío en PDF, con el diseño de la empresa | Abastecimiento | `proveedores` |
| `deposito` | Repuestos, stock, retiros, ajustes de inventario, familias, sectores, informe de reposición | Abastecimiento | — |
| `mantenimiento` | Equipos y reparaciones | Mantenimiento | `deposito` |
| `tareas` | Tareas con semáforo para cada persona | Base | — |

**Qué se instala según lo que contrata:** solo `tareas` → solo la **Base**; cualquiera de `proveedores`, `comisionistas`, `envios` o `deposito` → **Base + Abastecimiento**;
`mantenimiento` → los **tres**. La Base (usuarios, permisos, historial, configuración) siempre está.

### 5.2 Cómo se relacionan (los pisos no son independientes)

- **Envíos necesita Proveedores:** cada envío es de un proveedor. El comando **no te deja** activar uno sin el otro.
- **Mantenimiento necesita Depósito** (usa sus repuestos).
- **Reparaciones** (de Mantenimiento) necesitan además `proveedores`, y los **proveedores por repuesto** (del Depósito) también. Si el cliente no tiene
  Proveedores, esas dos funciones **no aparecen**, y el resto funciona normal.
- **Elegir un comisionista al armar un envío** necesita `envios` y `comisionistas`.
- Los demás funcionan solos.

### 5.3 Quién los cambia: dos llaves

Para que un módulo funcione tienen que estar prendidas **las dos**:

1. **La licencia: la manejás solo vos**, con un comando (o desde el panel). Dice qué módulos incluye el plan del cliente. Ni el dueño, ni la pantalla, ni hablando directo
   con la base de datos pueden agregarle módulos al plan.
2. **El interruptor del dueño:** dentro de lo que incluye su plan, el dueño puede **apagar y volver a prender** los módulos que no usa, en
   *Configuración → General → Módulos*. No puede prender nada que no esté en su plan, y no puede dejar un módulo sin lo que necesita (por ejemplo, apagar Proveedores
   con Envíos prendido). Cada cambio queda en el Historial con su nombre.

> Lo que impide que un cliente "encienda" algo que no contrató no es la licencia sola: es que **sus tablas ni siquiera están instaladas**. Por eso los componentes
> se instalan según el contrato.

### 5.4 Los comandos (desde la carpeta del proyecto)

**Ver qué tiene un cliente:**

```bash
pnpm cliente modulos --ref IDENTIFICADOR
```

**Ver qué pasaría al activar uno (no cambia nada):**

```bash
pnpm cliente modulos --ref IDENTIFICADOR --activar comisionistas
```

**Activarlo de verdad** (mismo comando, con `--confirmo` al final):

```bash
pnpm cliente modulos --ref IDENTIFICADOR --activar comisionistas --confirmo
```

**Apagar uno de verdad:**

```bash
pnpm cliente modulos --ref IDENTIFICADOR --desactivar tareas --confirmo
```

Se pueden poner varios separados por coma: `--activar tareas,comisionistas`.

- **`IDENTIFICADOR`** es el valor de `SUPABASE_PROJECT_REF` del archivo del cliente.
- **Sin `--confirmo` solo simula.** Mostrá siempre primero la simulación y recién después aplicá.
- El comando **rechaza combinaciones imposibles** (por ejemplo, apagar `proveedores` con `envios` activo) y **se niega a activar un módulo cuyo componente no está
  instalado en ese cliente** (primero se instala, ver 5.5).

### 5.5 Agregarle un componente a un cliente que ya existe

Por ejemplo, un cliente que tenía Base + Abastecimiento y ahora contrata Mantenimiento. **Sus datos no se tocan.**

```bash
pnpm cliente componente --ref IDENTIFICADOR --agregar mantenimiento              # simula: muestra qué se va a instalar
pnpm cliente componente --ref IDENTIFICADOR --agregar mantenimiento --confirmo   # lo instala
```

Después activás sus módulos como siempre (`pnpm cliente modulos --activar mantenimiento --confirmo`): **quedan apagados hasta que los activás**. No se puede instalar un
componente dos veces, ni sin lo que necesita (Mantenimiento necesita Abastecimiento). En el panel es el botón *Instalar componente* del detalle del cliente.

### 5.6 Qué pasa cuando se apaga un módulo

- Queda **bloqueado para todos, incluido el dueño**: sus tablas, sus funciones y sus carpetas de archivos.
- Las pantallas desaparecen en un máximo de **un minuto** en los navegadores abiertos.
- **Los datos no se borran.** Si lo volvés a activar, todo está donde estaba.
- Cada cambio queda en el **Historial** del cliente ("Administración del sistema" si lo hiciste vos; el nombre del dueño si lo apagó él).
- Una excepción: las **fotos ya subidas** se pueden abrir con su dirección exacta aunque el módulo esté apagado (lo que no
  se puede es subir, borrar ni listar). Las direcciones no se pueden adivinar.

### 5.7 Los módulos nuevos nacen apagados

Si en el futuro se agrega un módulo nuevo al sistema, **ningún cliente lo recibe hasta que se lo
activás**. Solo está activo lo que la licencia dice de forma expresa. Cómo se arma uno nuevo: `docs/NUEVO-MODULO.md`. El detalle técnico de componentes y licencia está en `docs/COMPONENTES.md`.

---

## 6. Usuarios y permisos

### 6.1 Cómo se organizan

Cada persona tiene **dos roles independientes** y algunos **permisos sueltos**:

**Rol en Directorio:** `Usuario`, `Administrador` o `Desactivado`.
**Rol en Depósito:** `Usuario`, `Administrador` o `Desactivado` (sin acceso).

**Permisos sueltos** (se tildan en la ficha del usuario):

| Permiso | Qué permite |
|---|---|
| Ver los retiros de todos | Ver (y corregir o borrar) los retiros de cualquier persona del Depósito |
| Ver el log de errores | Ver los errores que tuvo la aplicación |
| Resetear contraseñas | Resetear la contraseña de otros usuarios |
| Ver las sugerencias | Leer y borrar las sugerencias que mandan los usuarios |
| Ajustar el inventario | Sumar o restar stock de varios repuestos de una vez (solo para administradores del Depósito; los dueños siempre pueden). Ver el capítulo 8.6 |

**Dueño:** una persona con **todos** los poderes. **Puede haber varios dueños, todos iguales**, y el sistema nunca queda sin
ninguno. Un dueño puede crear, editar, bloquear y eliminar usuarios, ver el historial completo y agregar o quitar otros dueños.

### 6.2 Qué puede hacer cada uno

Esto es lo que impone **la base de datos**, que es lo que realmente cuenta:

| Acción | Usuario | Admin Directorio | Admin Depósito | Dueño |
|---|:-:|:-:|:-:|:-:|
| Ver proveedores, contactos y comisionistas | ✅ | ✅ | ✅ | ✅ |
| Crear y editar proveedores, contactos y comisionistas | ❌ | ✅ | ❌ | ✅ |
| Eliminar un proveedor | ❌ | ❌ | ❌ | ✅ |
| Crear un envío (rótulo) | ✅ | ✅ | ✅ | ✅ |
| Editar un envío | ❌ | ✅ | ❌ | ✅ |
| Eliminar un envío | ❌ | ❌ | ❌ | ✅ |
| Editar datos de la empresa, colores y rótulo | ❌ | ✅ | ❌ | ✅ |
| Crear un repuesto | ❌ | ❌ | ✅ | ✅ |
| Eliminar un repuesto | ❌ | ❌ | ❌ | ✅ |
| Crear y editar sectores | ❌ | ❌ | ✅ | ✅ |
| Crear familias | ❌ | ❌ | ✅ | ✅ |
| Editar o eliminar familias | ❌ | ❌ | ❌ | ✅ |
| Ver y crear reparaciones | ❌ | ❌ | ✅ | ✅ |
| Eliminar una reparación | ❌ | ❌ | ❌ | ✅ |
| Ajustar el inventario (con el permiso suelto) | ❌ | ❌ | ✅ solo con el permiso | ✅ |
| Anular un ajuste de inventario | ❌ | ❌ | ❌ | ✅ |
| Crear, ver, editar y borrar usuarios; asignar roles | ❌ | ❌ | ❌ | ✅ |
| Ver el historial de cambios | ❌ | ❌ | ❌ | ✅ |

**Acciones que dependen del rol "Usuario del Depósito"** (cualquiera con acceso al Depósito, sin ser administrador):

- Registrar sus propios retiros, y ver los suyos.
- Corregir o borrar **sus** retiros durante las primeras 24 horas.
- Ver los repuestos y su stock.

**Acciones que dependen de un permiso suelto:** ver todos los retiros, ver errores, ver sugerencias, resetear contraseñas, ajustar el inventario.

**Tareas:** cada persona ve y maneja las suyas.

### 6.3 Reglas especiales de los dueños

- Un usuario común **no puede** ascenderse a sí mismo, darse permisos ni hacerse dueño. Solo puede cambiar su nombre y apellido.
- A un dueño **no se lo puede bloquear ni eliminar**: primero hay que quitarle el cargo de dueño.
- **No se puede quitar al último dueño.**
- Un dueño puede resetear la contraseña de cualquiera (incluso de otro dueño), pero no la propia.
- Todo lo que hace un dueño sobre usuarios queda en el Historial.

### 6.4 Cómo crear un usuario

Siendo dueño:

1. *Configuración → General → Usuarios*.
2. Tocá **+ Nuevo usuario**.
3. Completá nombre, apellido, correo, contraseña (mínimo 6 caracteres) y los roles.
4. Si el Depósito es de la licencia, elegí también el rol en el Depósito.
5. Si le das el rol de administrador del Depósito, el permiso de ver todos los retiros se tilda solo (se puede destildar).
6. Guardá.

### 6.5 Lo que se puede hacer con un usuario ya creado

Desde su ficha (*Editar*): cambiar roles y permisos, **🔑 Contraseña** (resetear), **Bloquear / Desbloquear**,
**Eliminar**, **👑 Agregar como dueño**.

---

## 7. El asistente de configuración inicial

**Qué es:** una guía que se abre **sola** la primera vez que entra el dueño de una instalación nueva. Reúne, paso a paso,
la configuración de los módulos que el cliente tiene. Queda siempre disponible en
*Configuración → General → Configuración inicial*.

**Los pasos** (se saltean los que no corresponden a sus módulos):

| Paso | Qué se completa | Si el módulo falta |
|---|---|---|
| Empresa y marca | Logo, nombre, dirección, teléfono, email, **zona horaria**, **colores** | — (siempre) |
| Rótulos de envío | Diseño del rótulo | Sin `envios`, no aparece |
| Campos de comisionistas | Datos propios de cada comisionista | Sin `comisionistas`, no aparece |
| Sectores | Las áreas de la empresa | Sin `deposito`, no aparece |
| Familias de repuestos | Clasificación de repuestos (o desde una planilla) | Sin `deposito`, no aparece |
| Repuestos y stock | Carga inicial desde Excel o de a uno | Sin `deposito`, no aparece |
| Usuarios | Las primeras personas, con sus roles | — (siempre) |
| Resumen | Lo hecho y lo pendiente | — |

**Cómo se maneja:**

- Cada paso tiene **Anterior**, **Saltar este paso** y **Siguiente**.
- Un paso se tilda **solo** cuando ya hay datos cargados (se actualiza cada pocos segundos).
- Al final, **"Terminar y empezar a usar la aplicación"** lo cierra. También se puede cerrar antes con **"Terminar por ahora"**.
- Una vez cerrado, **no vuelve a abrirse solo**, pero se puede retomar cuando se quiera.

**Qué decirle al cliente:** "La primera vez que entres, te va a guiar. Si algo no lo tenés a mano, saltealo y lo completás después."

---

## 8. El día a día

### 8.1 Actualizar un cliente cuando mejoré la aplicación

Cuando yo agregue una mejora, te lo voy a decir. El orden normal es:

1. **Actualizar la base de datos del cliente** (carpeta del proyecto):

```bash
pnpm cliente actualizar --ref IDENTIFICADOR
```

   Aplica solo lo que falta y vuelve a publicar las funciones. Si no hay nada nuevo, no hace nada.
2. **Subir el código a GitHub.** Netlify actualiza **solo** el sitio de cada cliente cuando recibe cambios.

> Cuando una mejora **solo agrega** cosas, el orden de arriba es seguro. Si una mejora **quita** algo, avisame y te digo el
> orden correcto, para que los clientes no queden sin una pieza entre un paso y otro.

Repetí el paso 1 con cada cliente.

### 8.2 Un cliente compra un módulo más

```bash
pnpm cliente modulos --ref IDENTIFICADOR --activar nombre-del-modulo --confirmo
```

(Primero corré la versión sin `--confirmo`, para ver la simulación.)

**Si el módulo es de un componente que el cliente no tiene** (por ejemplo, compra `mantenimiento` y solo tenía Base + Abastecimiento), el comando te avisa y primero hay que
instalarlo: `pnpm cliente componente --ref IDENTIFICADOR --agregar mantenimiento --confirmo` (capítulo 5.5). Después se activa el módulo. En el panel: *Instalar componente* y
después *Aplicar cambios de módulos*.

### 8.3 Un cliente deja de pagar un módulo

```bash
pnpm cliente modulos --ref IDENTIFICADOR --desactivar nombre-del-modulo --confirmo
```

Sus datos no se borran. Si vuelve, se reactiva y todo está igual. (Esto es distinto de cuando **el dueño** apaga un módulo que sí paga pero no usa: lo hace él, desde
*Configuración → General → Módulos*, y también lo puede volver a prender.)

### 8.4 Un usuario del cliente se olvidó la contraseña

El dueño la resetea desde *Configuración → General → Usuarios → Editar → 🔑 Contraseña*. Si **el que se olvidó es el único
dueño**, no hay quién lo resetee: por eso conviene tener **dos dueños** (capítulo 3.3).

### 8.5 Un usuario ya no debe entrar

*Configuración → General → Usuarios → Editar → Bloquear*. No se puede bloquear a un dueño (primero se le quita el cargo).

El bloqueo **corta todo en la base de datos**: la persona no puede leer ni escribir nada ni subir archivos, aunque ya tenga la
aplicación abierta o entre por otro camino. Su pantalla la saca sola en menos de un minuto con el aviso "Tu cuenta está
desactivada". Se puede **desbloquear** con el mismo botón y vuelve a funcionar sin más trámite.

### 8.6 Ajustar el inventario (cuando salió material sin anotarse)

Sirve para corregir el stock de **varios repuestos de una vez**, sin hacerlo uno por uno. Es la forma de dejar registrado lo que
salió (o entró) sin anotarse en la aplicación.

**Dar el permiso:** un dueño abre *Configuración → General → Usuarios → Editar* a un administrador del Depósito y tilda
**"Puede ajustar el inventario"**. Los dueños ya lo tienen. Un usuario común no puede tenerlo.

**Hacer un ajuste:** en el Depósito, pestaña **⚖️ Ajustes → + Nuevo ajuste**.
1. Buscá un artículo y tocá **＋ Agregar**. Repetí con todos los que necesites.
2. En cada uno elegí **➕ Suma** o **➖ Resta** y la cantidad. Te muestra cómo va a quedar el stock. **Restar no puede dejar el stock en negativo.**
3. Escribí el **motivo** (obligatorio), por ejemplo "conteo de octubre".
4. **Confirmar ajuste**. El sistema te pide una confirmación más, porque no se puede editar ni borrar.

**Dónde queda registrado**
- **En cada repuesto:** en su historial de movimientos aparece como "Ajuste (suma)" o "Ajuste (resta)", con el stock de antes y de después y el motivo.
- **En la pestaña Ajustes:** la lista de todos los ajustes, con filtros (por ejemplo "Con restas", que es lo que salió sin anotarse), fechas y exportación a Excel.
- **En el Historial del sistema** (*Configuración → General → Historial*): cada ajuste y cada línea, con quién lo hizo.

**Si hubo un error:** un ajuste **no se edita ni se borra**. Un **dueño** puede **anularlo** (botón "Anular", con el motivo): el stock vuelve a como estaba,
el ajuste sigue en la lista marcado como "Anulado" (con quién, cuándo y por qué) y la anulación también queda en el Historial.
No se puede anular una suma si después salió material y el stock quedaría en negativo: en ese caso se hace otro ajuste que lo corrija.

### 8.7 Quién cambió qué

*Configuración → General → Historial* (solo dueños). Muestra, con quién y cuándo: cambios de repuestos y stock, retiros corregidos
o borrados, **ajustes de inventario y sus anulaciones**, usuarios (también cuando se da o se saca el permiso de ajustar), proveedores,
comisionistas, contactos y reparaciones, restablecimientos de contraseña y cambios de módulos. Muestra los últimos 200 movimientos.

### 8.8 Errores y sugerencias

- **Errores:** *Configuración → General → Errores*, para quien tenga ese permiso.
- **Sugerencias:** *Configuración → General → Sugerencias*, para quien tenga ese permiso. Las manda cada usuario desde su menú.

---

## 9. Si algo sale mal

| Qué pasa | Qué hacer |
|---|---|
| `pnpm cliente` dice que no encuentra el comando o `node` | Estás en la carpeta equivocada o falta instalar. Hacé el capítulo 2.3 de nuevo. |
| El instalador dice `✖ Falta --modulos` | Agregá `--modulos proveedores,deposito` (o `--modulos todos`). |
| `✖ Módulo desconocido` | Revisá cómo escribiste el nombre. Los válidos: `proveedores, comisionistas, envios, deposito, mantenimiento, tareas`. |
| `✖ "envios" necesita "proveedores"` (o `"mantenimiento" necesita "deposito"`) | Sumá el que falta a la lista. |
| `✖ "..." es del componente ..., que no está instalado en este cliente` | Instalá el componente primero (capítulo 5.5) y después activá el módulo. |
| El instalador falla al **crear el proyecto** | Casi seguro llegaste al límite de 2 proyectos del plan gratis, o no tenés permiso en esa organización. Mirá el mensaje que imprime. |
| `✖ Este proyecto ya tiene tablas pero no fue instalado con este script` | Estás apuntando a un proyecto que ya existía. No toca nada. Ver el capítulo 10 si es una instalación vieja que querés adoptar. |
| Al entrar dice **"Email o contraseña incorrectos"** | Revisá que copiaste bien la contraseña del archivo. Si no coincide, otro dueño puede resetearla. |
| Entra, pero no se abre el asistente | Probablemente ya se cerró antes. Entrá a *Configuración → General → Configuración inicial*. |
| El cliente **no ve un módulo** que contrató | Corré `pnpm cliente modulos --ref IDENTIFICADOR` para ver su licencia. Si figura apagado, activalo. Si figura activo, esperá un minuto o recargá. |
| El cliente **ve un módulo** que no contrató | Corré el mismo comando y revisá. Si figura activo, apagalo con `--desactivar ... --confirmo`. |
| La pantalla dice **"No hay módulos disponibles"** | Todos los módulos a los que tiene acceso están apagados: por la licencia o porque el dueño los apagó. Revisá la licencia; si es el dueño, puede prenderlos en *Configuración → General → Módulos*. |
| El dueño dice que **un módulo desapareció** y vos no lo tocaste | Probablemente lo apagó él en *Configuración → General → Módulos* (puede volver a prenderlo). Si ahí no figura el módulo, entonces no está en su plan. |
| Netlify publicó pero la página sale en blanco o no deja entrar | Casi seguro las dos variables de Netlify están mal copiadas o faltan. Revisalas y volvé a publicar. |
| Un cliente dice que se registró solo | Falta cerrar el registro público (capítulo 4, paso 5). El instalador avisa si está abierto. |
| Las tareas "de hoy" aparecen en el día equivocado, o no se puede crear una tarea de noche | La **zona horaria** de la empresa está mal. Se cambia en *Configuración → General → Empresa → Zona horaria* (por defecto Argentina). |
| Algo extraño que no figura acá | Copiá el mensaje completo y consultame. No cambies nada en la base de datos a mano. |

**Regla de oro:** si un comando muestra un mensaje que empieza con `✖`, **no es un desastre**: es el sistema avisando que no
hizo nada porque algo estaba mal. Leélo y corregí el dato.

---

## 10. Pasar una instalación que ya existe (Cremac) a la plantilla

**Qué se logra:** que Cremac pase a ser el cliente número 1 de la plantilla, con el mismo código que los demás.

**Antes de empezar, tené en cuenta:**

- Hoy el proyecto de Cremac está en el plan **gratis**, que **no tiene copias de seguridad restaurables**. Una mudanza de
  este tipo conviene hacerla con una copia de los datos importantes (por ejemplo, exportar las planillas) o, mejor, con
  un plan que tenga copias.
- Hacelo en un momento en que nadie esté usando la aplicación.
- Antes de tocar nada, pedime que revise el estado actual de la base de Cremac, para confirmar que sigue siendo igual a la
  base de la plantilla.

**El paso principal** (carpeta del proyecto):

```bash
pnpm cliente actualizar --ref IDENTIFICADOR-DE-CREMAC --marcar-hasta 20260101000000_esquema_base.sql
```

**Qué hace:** registra como "ya hechas" las migraciones hasta la base inicial (que Cremac ya tiene), sin ejecutarlas, y aplica las siguientes:
las mejoras de la plantilla, los colores, la **licencia de módulos** (con todos los módulos activos), el bloqueo, el asistente
(que **no se abre** en una instalación que ya tenía dueño), y tres correcciones de seguridad y de hora que salieron de la prueba
exhaustiva: los contactos de proveedores dejan de ser legibles sin iniciar sesión, un usuario bloqueado deja de tener permisos en
la base, y "hoy" pasa a ser el día de la empresa (se podían crear tareas de noche).
Cremac se trata como instalación **completa** (Base + Abastecimiento + Mantenimiento), así que recibe las migraciones de los tres componentes. Lo último que se aplica es la
licencia por componentes: la licencia anota los componentes instalados, aparece el módulo **`mantenimiento`** (prendido, porque Cremac ya tenía el depósito prendido: no pierde nada)
y el dueño gana la pantalla *Configuración → General → Módulos*.

**El orden importa:** primero esta actualización de la base, **después** publicar la aplicación. Si se publicara la app antes, la pestaña Reparaciones quedaría oculta hasta que la
licencia tenga el módulo `mantenimiento`.

**Después:**

1. Comprobar la licencia: `pnpm cliente modulos --ref IDENTIFICADOR-DE-CREMAC` tiene que mostrar los seis módulos, todos activos.
2. Publicar la aplicación de Cremac desde la plantilla (en Netlify, apuntar el sitio de Cremac al repositorio `gestion-empresarial`
   con las mismas dos variables de siempre).
3. Revisar que todo funcione como antes (en especial Reparaciones).

**Importante:** las funciones de Cremac que crean, resetean y eliminan usuarios también se corrigen solas con este paso, porque
la plantilla ya las trae corregidas (eliminar usuarios ya no deja una cuenta a medias, y solo pide ser dueño).

---

## 11. Lo que todavía no existe

Para no prometer de más. El detalle completo está en `docs/PENDIENTES.md`.

**Imprescindible antes de vender:**

- **Cambiar mi contraseña y Olvidé mi contraseña.** Hoy no existen (capítulo 3.3).
- **Copias de seguridad** de los datos de los clientes. El plan gratis de Supabase no las tiene restaurables.

**Importante:**

- Los **formatos de código** del catálogo de repuestos son los de la primera empresa (familias y subfamilias de exactamente
  2 letras mayúsculas), y el importador de stock espera la planilla de esa empresa.
- Los nombres **"Directorio"** y **"Depósito de mantenimiento"** están fijos en las pantallas.
- Los formatos de fecha y los ejemplos son de Argentina; un solo idioma.
- La **auditoría** no registra todavía envíos, configuración de la empresa, sectores, familias ni proveedores por repuesto.

**Funciones planeadas:** equipos con sus manuales y despieces (el servidor de archivos ya está listo), órdenes de trabajo,
mantenimiento programado, avisos. El plan completo de crecimiento (requerimientos y compras, varios depósitos, Administración) está en `docs/PLAN-PRODUCTO.md`.

**Del panel de administración:** está construido y probado, pero todavía **no está instalado en un servidor** ni se probó con la API real de Supabase (falta la segunda
cuenta de pruebas). Hasta entonces, los comandos de este manual son el camino.

---

## 12. Dónde está cada cosa

Todo está dentro de la carpeta `Gestion empresarial`:

| Carpeta o archivo | Qué contiene |
|---|---|
| `docs/` | Esta documentación |
| `docs/MANUAL-PASO-A-PASO.md` | **Este manual** |
| `docs/NUEVO-CLIENTE.md` | La versión corta y técnica de la instalación |
| `docs/NUEVO-MODULO.md` | Cómo se agrega un módulo nuevo al sistema |
| `docs/COMPONENTES.md` | Componentes, módulos, licencia e interruptor del dueño (referencia técnica) |
| `docs/ARQUITECTURA.md` | Cómo está armado por dentro |
| `docs/SEGURIDAD.md` | Qué protecciones tiene, y qué verifica la prueba |
| `docs/PLAN-PRODUCTO.md` | Hacia dónde crece el producto (planes, hoja de ruta) |
| `docs/PENDIENTES.md` | Lo que falta |
| `docs/PANEL-INSTALACION.md`, `PANEL-DISENO.md`, `PANEL-SEGURIDAD.md` | El panel de administración: instalarlo, cómo está pensado y su informe de seguridad |
| `src/` | El código de las pantallas |
| `supabase/componentes/` | La base de datos, por componentes (base, abastecimiento, mantenimiento), en orden |
| `supabase/migrations/` | Las 11 migraciones originales, congeladas (historial de Cremac y referencia de las pruebas) |
| `supabase/functions/` | Las funciones para crear, resetear y eliminar usuarios |
| `panel/` | El panel de administración de clientes (proyecto aparte) |
| `scripts/cliente.mjs` | El instalador (`pnpm cliente`) |
| `scripts/pruebas/integracion.mjs` | La prueba automática completa de una instalación (contra un Supabase de pruebas) |
| `scripts/pruebas/esquema/` | Las pruebas de la base de datos desde cero, en memoria (`pnpm pruebas:esquema`) |
| `servidor-manuales/` | El servidor de archivos (opcional, aún no conectado) |
| `clientes/` | **Los datos privados de cada cliente** (no se suben a GitHub; hacé copia) |
| `.env` | La conexión de tu entorno de pruebas (no se sube) |

---

## 13. Glosario

| Palabra | Qué significa |
|---|---|
| **Aplicación** | Lo que el cliente abre en el navegador |
| **Módulo** | Una parte de la aplicación que se vende por separado |
| **Licencia** | La lista de módulos que tiene contratados un cliente (la manejás vos) |
| **Componente** | Un grupo de módulos con sus tablas (Base, Abastecimiento, Mantenimiento); a cada cliente se le instalan solo los que contrata |
| **Interruptor del dueño** | Lo que el dueño puede apagar y prender dentro de su plan (*Configuración → General → Módulos*) |
| **Panel** | La herramienta del celular que hace lo mismo que los comandos `pnpm cliente`, con firma de huella en cada operación |
| **Proyecto** (de Supabase) | La base de datos privada de un cliente |
| **Identificador** (o `ref`) | El código de unas 20 letras que identifica el proyecto de un cliente; está en su archivo privado |
| **Dueño** | La persona con todos los poderes dentro de la aplicación de un cliente |
| **Migración** | Un archivo que prepara o mejora la base de datos; se aplican en orden |
| **Repositorio** | La carpeta del código guardada en GitHub |
| **Commit / push** | Guardar un cambio / subirlo a GitHub |
| **Terminal** | La ventana negra donde se escriben los comandos |
| **Netlify** | El servicio donde se publica la aplicación de cada cliente |
| **Variable de entorno** | Un dato de configuración que no se escribe en el código (por ejemplo, la dirección del proyecto) |
| **Clave secreta / de servicio** | Una clave con poderes totales sobre un proyecto; nunca se comparte |
| **Servidor de archivos** | Tu servidor de Digital Ocean para manuales pesados (todavía no conectado) |

---

## 14. Lista de verificación de entrega

Copiala y tildala con cada cliente:

**Antes**
- [ ] Acordé con el cliente los **módulos** que contrata (de ahí salen los componentes que se le instalan).
- [ ] El cliente tiene su **propia cuenta de Supabase con plan Pro** y estoy invitado a su organización (o el panel, si uso el panel).
- [ ] Dejé acordado **quién paga** Supabase.

**Instalación**
- [ ] Corrí `pnpm cliente nuevo ...` y terminó con `✔ Listo`.
- [ ] Hice **copia del archivo** `clientes/...env.local` en un lugar seguro.
- [ ] **Cerré el registro público** en Supabase.
- [ ] Publiqué en **Netlify** (con las **dos** variables, y ninguna más).
- [ ] Puse la dirección de Netlify en **Site URL** de Supabase.

**Pruebas**
- [ ] La pantalla de ingreso muestra el **nombre de la empresa**.
- [ ] Entré como dueño y se abrió el **asistente**.
- [ ] Se ven **solo los módulos contratados**.
- [ ] Dejé **dos dueños**.

**Entrega**
- [ ] Le di al cliente: dirección, correo y contraseña inicial, por un medio seguro.
- [ ] Le avisé que **todavía no puede cambiar su contraseña** (mientras no exista esa función).
- [ ] Anoté en mi lista: nombre del cliente, identificador del proyecto, módulos, fecha y quién paga Supabase.
