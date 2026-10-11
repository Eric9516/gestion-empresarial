// Arranque en producción: node src/principal.ts (Node 24 ejecuta TypeScript directo).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { crearAlmacenPg } from './server/almacen.ts';
import { cargarConfig, ConfigInvalida } from './server/config.ts';
import { crearManejador } from './server/manejador.ts';
import { crearPermitidas } from './server/organizaciones.ts';
import { registrar } from './server/registro.ts';
import { crearSupabaseApi } from './server/supabaseApi.ts';
import { cargarInterfaz, crearServidor } from './servidor.ts';

try {
  const config = cargarConfig(process.env);
  const almacen = crearAlmacenPg(config.dbUrl);
  const api = crearSupabaseApi(config.tokenSupabase, crearPermitidas(config, almacen), config.pasoTimeoutMs);
  const manejador = crearManejador({ config, almacen, api });
  // Empaquetado (dist/panel.mjs) la interfaz está en dist/web; corriendo desde src/ está en ../dist/web.
  const carpetaWeb = [join(import.meta.dirname, 'web'), join(import.meta.dirname, '..', 'dist', 'web')].find(c => existsSync(join(c, 'index.html')));
  if (!carpetaWeb) throw new Error('No encuentro la interfaz (dist/web). Corré el armado antes de arrancar.');
  const interfaz = cargarInterfaz(carpetaWeb);
  const servidor = crearServidor(config, manejador, interfaz);
  // Solo en el propio equipo: lo único que lo alcanza es el proxy de Tailscale instalado en el servidor.
  servidor.listen(config.puerto, '127.0.0.1', () => registrar('info', 'panel_iniciado', { puerto: config.puerto, origen: config.origen }));
  const apagar = () => { servidor.close(() => { void almacen.cerrar().finally(() => process.exit(0)); }); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.on('SIGTERM', apagar);
  process.on('SIGINT', apagar);
} catch (e) {
  registrar('error', 'no_arranca', { problemas: e instanceof ConfigInvalida ? e.problemas : [e instanceof Error ? e.message : 'error'] });
  process.exit(1);
}
