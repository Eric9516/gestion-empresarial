// Configuración de pm2: mantiene el servidor de archivos andando y lo reinicia si se cae.
module.exports = {
  apps: [{
    name: 'manuales-api',
    script: 'server.mjs',
    cwd: '/opt/manuales-api',
    node_args: '--env-file=/opt/manuales-api/.env',
    max_memory_restart: '250M',
    autorestart: true,
    restart_delay: 3000,
  }],
};
