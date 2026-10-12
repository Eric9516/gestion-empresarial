# Instalar un cliente nuevo

Cada cliente tiene **su propio proyecto de Supabase** (su base de datos, sus usuarios y sus archivos) y su
propio sitio publicado. El código es el mismo para todos; lo que cambia es la configuración y los componentes que contrata
(ver [COMPONENTES.md](COMPONENTES.md)).

Esto describe el instalador de la computadora (`pnpm cliente`). Lo mismo se puede hacer desde el celular con el panel de administración: ver [PANEL-INSTALACION.md](PANEL-INSTALACION.md).

## Antes de empezar (una sola vez en tu PC)

1. Tener Node 24 y pnpm (`npm install -g pnpm`), y haber corrido `pnpm install` en este proyecto.
2. Dejar la llave de tu cuenta de Supabase (una sola vez): generarla en https://supabase.com/dashboard/account/tokens y pegarla en `clientes/cuenta-supabase.env.local` (`pnpm cliente organizaciones` deja el archivo preparado y explica cómo).
3. Cada cliente va en **su propia organización de Supabase, con el plan Pro a su cargo**, y te invita como administrador (el plan gratis solo permite 2 proyectos
   activos por cuenta, se pausa solo y no tiene copias de seguridad restaurables).

## Instalar

```bash
pnpm cliente nuevo --nombre "Nombre del Cliente SA" --email dueno@cliente.com --modulos proveedores,envios,deposito
```

`--modulos` es **obligatorio**: la lista de lo que **contrata el cliente** (o `--modulos todos`). Así nunca se activa por
descuido algo que no compró. Los módulos son: `proveedores`, `comisionistas`, `envios` (necesita `proveedores`), `deposito`,
`mantenimiento` (necesita `deposito`) y `tareas`. Se validan las dependencias antes de crear nada, y **solo se instalan los componentes de esos módulos**:
solo `tareas` instala únicamente la Base; `proveedores`, `comisionistas`, `envios` o `deposito` instalan Base + Abastecimiento; `mantenimiento` instala los tres.

Si el cliente va a tener su propia cuenta de Supabase, se instala en su organización con `--org <identificador>`
(se averigua con `pnpm cliente organizaciones`, después de que él te invite a su organización).

El comando, sin pedir nada más:

1. Crea el proyecto en Supabase (región São Paulo por defecto; se cambia con `--region`).
2. Espera a que esté listo.
3. Instala la base de datos (las migraciones de los componentes que contrata, en orden) y deja anotado cuáles aplicó.
4. Publica las funciones del servidor (crear, resetear y eliminar usuarios).
5. Crea al primer dueño con una contraseña inicial aleatoria y le pone el nombre de la empresa.
6. Define la licencia de módulos del cliente.
7. Guarda todos los datos del cliente en `clientes/<nombre>.env.local` (**archivo privado, no se sube a Git**).

Si el proyecto de Supabase ya está creado y vacío, se usa con `--ref <identificador>`.

## Lo que hay que hacer a mano

La plataforma no permite estos pasos por comando:

1. **Supabase → Authentication → Sign In / Providers:** desactivar *Allow new users to sign up*. Los usuarios los
   crea el dueño desde la app. Si queda activado, cualquiera con la dirección del proyecto puede registrarse
   (queda sin permisos, pero conviene cerrarlo).
2. **Supabase → Authentication → URL Configuration:** poner la dirección donde se publique la app.
3. **Publicar la app** (por ejemplo en Netlify): comando de build `pnpm build`, carpeta `dist`, y las variables
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del archivo del cliente. Las otras claves del archivo (la de servicio
   y la contraseña de la base) **no van en el hosting**.
4. **Entrar como dueño.** Se abre solo el asistente de *Configuración inicial*: empresa y colores, y según los módulos
   del cliente, rótulos, campos de comisionistas, sectores, familias, carga de stock y usuarios. Cada paso se puede
   saltear, se marca como hecho solo cuando ya hay datos, y el asistente queda siempre disponible en
   *Configuración → General → Configuración inicial*.

## Módulos: los define quien vende; el dueño puede apagar los suyos

Los módulos son la licencia del cliente. **Lo que incluye el plan solo lo cambia quien vende** (ni el dueño, ni por la pantalla, ni
hablando directo con la base): se cambia con este comando (o desde el panel), que usa la clave de servicio. Dentro de su plan, el dueño puede **apagar y volver a prender**
los módulos que no usa desde *Configuración → General → Módulos*; no puede prender nada que el plan no incluya.

```bash
pnpm cliente modulos --ref <identificador>                                  # ver el estado
pnpm cliente modulos --ref <identificador> --activar comisionistas          # simula el cambio
pnpm cliente modulos --ref <identificador> --desactivar tareas --confirmo   # lo aplica
```

**Componentes.** La base de datos del cliente se arma por componentes: Base (siempre), Abastecimiento y Mantenimiento. `nuevo` instala solo
los componentes de los módulos que contrata (Tareas → solo Base; Proveedores, Comisionistas, Envíos o Depósito → Base + Abastecimiento;
Mantenimiento → los tres). Lo que no se contrata no existe en su base. Para ampliar más adelante, sin tocar sus datos:

```bash
pnpm cliente componente --ref <identificador> --agregar mantenimiento              # simula
pnpm cliente componente --ref <identificador> --agregar mantenimiento --confirmo   # lo instala
```

Los módulos del componente nuevo quedan **apagados** hasta que los actives con `pnpm cliente modulos --activar ...`, que además se niega a
activar un módulo cuyo componente no está instalado.

- Sin `--confirmo` solo **simula**: muestra el antes y el después y qué queda bloqueado.
- Rechaza combinaciones imposibles (por ejemplo, apagar `proveedores` con `envios` activo).
- Un módulo apagado queda **bloqueado en la base de datos para todos**, incluido el dueño: sus tablas, sus funciones y sus
  carpetas de archivos. Los datos no se borran; si se vuelve a activar, vuelven a estar.
- Cada cambio queda en el Historial del cliente como "Administración del sistema".
- **Un módulo nuevo del sistema nace apagado** en todos los clientes: solo está activo lo que la licencia dice de forma
  expresa. Ver `NUEVO-MODULO.md`.
- Un cliente que ya existía (antes de los componentes) se actualiza igual: `pnpm cliente actualizar` le aplica solo las migraciones nuevas de los componentes que ya tiene.

## Actualizar un cliente

Cuando se agrega una migración nueva o se mejora una función:

```bash
pnpm cliente actualizar --ref <identificador-del-proyecto>
```

Aplica solo las migraciones que faltan **de los componentes que el cliente ya tiene** y vuelve a publicar las funciones. Si no hay nada nuevo, no hace nada.
Con `--solo-base` no toca las funciones.

## Pasar una instalación que ya existe a la plantilla

El comando **se niega** a tocar un proyecto que ya tiene tablas pero no fue instalado con él. Para adoptarlo:

```bash
pnpm cliente actualizar --ref <identificador> --marcar-hasta 20260101000000_esquema_base.sql
```

Registra como "ya hechas" las migraciones hasta esa (la base que esa instalación ya tiene) **sin ejecutarlas**, y
aplica las siguientes (la licencia arranca con todos los módulos activos, y el asistente de configuración inicial no se
abre en una instalación que ya tenía dueño). Antes de hacerlo en una instalación con datos reales: probarlo en una copia, y revisar
que `20260101000100_mejoras_plantilla.sql` no choque con lo que esa instalación tenga (por ejemplo, elimina
la función `transferir_ownership`).

## Verificar una instalación

En un proyecto **de pruebas** (nunca en uno con usuarios reales):

```bash
pnpm pruebas:integracion --cliente clientes/<nombre>.env.local --es-un-proyecto-de-pruebas
```

Pide un proyecto con los tres componentes instalados (`--modulos todos`). Crea usuarios y datos de prueba, comprueba permisos, dueños, stock, auditoría, funciones, módulos y colores
(más de 100 comprobaciones, incluida una matriz que apaga cada módulo y verifica qué queda bloqueado, y el interruptor del dueño), y limpia lo que creó. Se niega a correr si encuentra usuarios que no sean de prueba.
