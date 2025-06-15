module.exports = {
  apps: [{
    name: 'muse-autopost',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      HEADLESS: 'false'
    },
    env_production: {
      NODE_ENV: 'production',
      HEADLESS: 'true'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    merge_logs: true,
    kill_timeout: 5000,
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};