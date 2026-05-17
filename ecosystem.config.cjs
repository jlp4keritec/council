// Configuration PM2 — mode Node standard.
// Pas de venv, pas d'interpreter custom : juste node sur le script principal.

module.exports = {
  apps: [{
    name: 'llm-council',
    cwd: '/home/ubuntu/llm-council',
    script: 'backend/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/home/ubuntu/.pm2/logs/llm-council-error.log',
    out_file:   '/home/ubuntu/.pm2/logs/llm-council-out.log',
    time: true,
  }],
};
