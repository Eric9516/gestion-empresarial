// Servidor de DESARROLLO (solo para probar la interfaz a mano): base en memoria y Supabase simulado. No se usa en producción.
//
//   node test/ayudas/dev.ts                      →  http://localhost:3100  (llave de acceso del Windows Hello de la PC)
//   node test/ayudas/dev.ts --tailscale NOMBRE USUARIO
//        →  para probar desde el celular por Tailscale. Después, en otra terminal:
//           tailscale serve --bg --https=443 http://127.0.0.1:3100
//
// NOMBRE es el nombre de la PC en la red privada (p. ej. eric.tail4b69fd.ts.net) y USUARIO el correo de la cuenta de Tailscale.
import { join } from 'node:path';
import { crearManejador } from '../../src/server/manejador.ts';
import { crearPermitidas } from '../../src/server/organizaciones.ts';
import { crearSupabaseApi } from '../../src/server/supabaseApi.ts';
import { cargarInterfaz, crearServidor } from '../../src/servidor.ts';
import { crearBase } from './bd.ts';
import { CODIGO_ALTA, configDePrueba } from './mundo.ts';
import { crearSupabaseFalso } from './supabaseFalso.ts';

const puerto = Number(process.env.PUERTO ?? 3100);
const i = process.argv.indexOf('--tailscale');
const redPrivada = i >= 0 ? { nombre: process.argv[i + 1] ?? '', usuario: process.argv[i + 2] ?? '' } : null;
if (redPrivada && (!/^[a-z0-9.-]+\.ts\.net$/.test(redPrivada.nombre) || !redPrivada.usuario.includes('@'))) {
  console.error('Uso: node test/ayudas/dev.ts --tailscale nombre.red.ts.net tu-correo@ejemplo.com');
  process.exit(1);
}

const config = redPrivada
  ? configDePrueba({ origen: `https://${redPrivada.nombre}`, rpId: redPrivada.nombre, usuarioRed: redPrivada.usuario, alertaUrl: null, encabezadoIp: '', desarrollo: true, puerto })
  : configDePrueba({ origen: `http://localhost:${puerto}`, rpId: 'localhost', usuarioRed: null, alertaUrl: null, encabezadoIp: '', desarrollo: true, puerto });
const base = await crearBase({ aislada: true });
const falso = crearSupabaseFalso({ sondeosParaListo: 2 });
// Tres clientes de ejemplo, uno por cada combinación de componentes: completo, sin Mantenimiento y solo Base.
falso.proyectoInstalado('Panadería Sol', ['deposito', 'mantenimiento', 'tareas', 'proveedores']);
falso.proyectoInstalado('Ferretería Norte', ['proveedores', 'envios', 'deposito'], ['base', 'abastecimiento']);
falso.proyectoInstalado('Taller Solo Tareas', ['tareas'], ['base']);
const api = crearSupabaseApi(config.tokenSupabase, crearPermitidas(config, base.almacen), 5000, falso.fetch);
const manejador = crearManejador({ config, almacen: base.almacen, api, fetchImpl: falso.fetch });
const servidor = crearServidor(config, manejador, cargarInterfaz(join(import.meta.dirname, '..', '..', 'dist', 'web')));
servidor.listen(puerto, '127.0.0.1', () => {
  console.log(`Panel de demostración en ${config.origen}`);
  console.log(`Código de alta: ${CODIGO_ALTA}`);
  if (redPrivada) console.log(`Falta (en otra terminal): tailscale serve --bg --https=443 http://127.0.0.1:${puerto}`);
});
