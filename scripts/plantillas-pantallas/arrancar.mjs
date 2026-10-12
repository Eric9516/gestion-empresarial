// Se ejecuta solo al terminar "pnpm install": deja la aplicación corriendo y abre el navegador.
// (No lo hace en servidores de pruebas automáticas ni dentro de Claude: ahí se usa "pnpm run dev".)
import { spawn } from 'node:child_process';

if (process.env.CI || process.env.CLAUDECODE || process.env.SIN_ARRANQUE_AUTOMATICO) process.exit(0);

console.log('\n✔ Todo instalado. Arrancando la aplicación… (para cortarla: Ctrl + C)\n');
const hijo = spawn('pnpm', ['exec', 'vite', '--open'], { stdio: 'inherit', shell: true });
hijo.on('exit', (codigo) => process.exit(codigo ?? 0));
process.on('SIGINT', () => { hijo.kill(); process.exit(0); });
