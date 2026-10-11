// Genera los secretos del panel con el generador aleatorio seguro del sistema. NO escribe nada en disco: los muestra una vez
// por pantalla para que los copies al archivo de configuración del servidor (y a tu gestor de contraseñas).
//
//   node scripts/generar-secretos.mjs
import { randomBytes } from 'node:crypto';

const nuevo = (bytes) => randomBytes(bytes).toString('base64url');
console.log(`
Copiá estos valores a un lugar seguro (tu gestor de contraseñas). No se guardan en ningún otro lado.

PANEL_SECRETO=${nuevo(48)}
PANEL_CODIGO_ALTA=${nuevo(36)}
CLAVE_DE_LA_BASE_DEL_PANEL=${nuevo(36)}
TEMA_DE_AVISOS_(para ntfy)=panel-${nuevo(18)}

- PANEL_SECRETO: firma internamente huellas de IP/navegador y deriva las contraseñas iniciales de los dueños.
- PANEL_CODIGO_ALTA: se escribe UNA vez al registrar tu primera llave de acceso (y al recuperar acceso).
- CLAVE_DE_LA_BASE_DEL_PANEL: contraseña del usuario "panel_app" de la base del panel.
- TEMA_DE_AVISOS: nombre secreto de tu canal de avisos en el celular (app ntfy): quien lo conozca puede leerlo, así que es largo.
`);
