module.exports = {
  apps: [
    {
      name: 'wangbot',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      exp_backoff_restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
