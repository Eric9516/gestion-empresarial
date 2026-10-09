# Servidor de archivos

Programa que guarda y entrega los archivos pesados (manuales, despieces, planos) en un servidor propio,
aparte de Supabase. **No guarda datos de negocio:** solo los archivos y, junto a cada uno, un `.json`
chico con su nombre original, tipo y tamaño. La "ficha" del documento (de qué equipo es, qué tipo es)
va en la base de datos de la app.

## Qué hace

| Pedido | Quién puede | Qué hace |
|---|---|---|
| `GET /api/salud` | cualquiera | Responde `{"ok":true}` |
| `POST /api/archivos` (formulario con el campo `archivo`) | administradores del Depósito y dueños | Guarda el archivo y devuelve su `id` |
| `GET /api/archivos/:id/enlace` | cualquier usuario del Depósito | Devuelve un link de descarga que vence a los 10 minutos |
| `GET /api/d/:token` | quien tenga el link | Entrega el archivo (con descarga parcial para PDFs grandes) |
| `DELETE /api/archivos/:id` | administradores del Depósito y dueños | Borra el archivo |

La sesión de cada persona se valida contra Supabase en cada pedido: si se le saca el acceso, deja de poder usarlo.
Máximo 500 MB por archivo. Tipos permitidos: PDF, imágenes, Word, Excel, PowerPoint, texto, CSV, ZIP, DWG y DXF.

## Instalación en un servidor Ubuntu 24.04

Resumen de lo que hay que dejar armado (todo se probó en un servidor real):

1. **Seguridad básica:** actualizar el sistema, cortafuegos (`ufw`) abriendo solo 22, 80 y 443, `fail2ban`,
   y acceso por SSH solo con llave.
2. **Programas:** Nginx, Node 24 (descargado de nodejs.org verificando la huella), pm2 y Certbot.
3. **Usuario sin poderes** para correr el programa: `adduser --system --group --home /home/manuales manuales`,
   y sumar `www-data` a su grupo (`usermod -aG manuales www-data`).
4. **Carpetas:** `/opt/manuales-api` (el programa), `/srv/manuales/archivos` y `/srv/manuales/tmp`
   (de dueño `manuales`; `/srv/manuales` con permisos 750).
5. **El programa:** copiar `server.mjs`, `package.json`, `package-lock.json` y `ecosistema.config.cjs` a
   `/opt/manuales-api`, y como usuario `manuales` correr `npm install --omit=dev`.
6. **Configuración:** copiar `.env.example` a `/opt/manuales-api/.env`, completarlo (el secreto de los links se
   genera con `openssl rand -hex 32`) y dejarlo con permisos 600.
7. **Nginx:** copiar `nginx/limites.conf` a `/etc/nginx/conf.d/manuales-limites.conf` y `nginx/sitio.conf.plantilla`
   a `/etc/nginx/sites-available/manuales` (cambiando `DOMINIO`), enlazarlo en `sites-enabled`, y `nginx -t`.
8. **Candado de seguridad (HTTPS):** `certbot --nginx -d DOMINIO`. Hace falta un nombre de dominio que apunte
   al servidor (puede ser un subdominio gratuito). La renovación es automática.
9. **Arranque:** como usuario `manuales`, `pm2 start ecosistema.config.cjs`, `pm2 save`, y como administrador
   `pm2 startup systemd -u manuales --hp /home/manuales` para que vuelva solo tras un reinicio.
10. **Prueba:** `curl https://DOMINIO/api/salud` debe responder `{"ok":true}`.

## Cosas a tener en cuenta

- **Copias de seguridad:** el servidor no hace copias. Conservar los originales en otro lado, o activar las
  copias del proveedor de hosting.
- **Espacio:** el programa se niega a recibir archivos si quedan menos de 2 GB libres.
- **La app todavía no usa este servidor:** falta la pantalla de equipos y documentos y la tabla de fichas.
