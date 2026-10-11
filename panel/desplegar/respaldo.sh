#!/bin/sh
# Copia de seguridad diaria de la base del panel (llaves públicas, auditoría, sesiones). Se instala con panel-respaldo.timer.
# La base NO tiene datos de clientes, así que perderla no es grave (se vuelve a registrar la llave), pero la auditoría sí vale
# la pena conservarla. Guarda 14 días, con permisos solo para root. Verifica que la copia se pueda leer.
set -eu
DESTINO=/var/backups/panel
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
ARCHIVO="$DESTINO/panel-$(date +%F).dump"
runuser -u postgres -- pg_dump --format=custom --no-owner panel > "$ARCHIVO.tmp"
chmod 600 "$ARCHIVO.tmp"
pg_restore --list "$ARCHIVO.tmp" > /dev/null   # si la copia está rota, falla acá y no reemplaza nada
mv "$ARCHIVO.tmp" "$ARCHIVO"
find "$DESTINO" -name 'panel-*.dump' -mtime +14 -delete
echo "respaldo ok: $ARCHIVO"
