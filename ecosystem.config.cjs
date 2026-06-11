/**
 * PM2 Ecosystem Config — RasoKart API Server
 *
 * SETUP:
 *   1. Copy this file to /var/www/rasokart/ecosystem.config.cjs
 *   2. Fill in DATABASE_URL and SESSION_SECRET with your actual values
 *   3. Run: pm2 start ecosystem.config.cjs && pm2 save
 *
 * Generate SESSION_SECRET:
 *   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
 *
 * DATABASE_URL format:
 *   postgres://rasokart_user:YOUR_PASSWORD@localhost:5432/rasokart
 */

module.exports = {
  apps: [
    {
      name: "rasokart-api",
      cwd: "/var/www/rasokart/artifacts/api-server",
      script: "./dist/index.mjs",
      interpreter: "node",
      interpreter_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
        DATABASE_URL: "postgres://rasokart_user:CHANGE_THIS@localhost:5432/rasokart",
        SESSION_SECRET: "REPLACE_WITH_64_CHAR_HEX_FROM_CRYPTO_RANDOM",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 3000,
      error_file: "/var/log/rasokart/api-error.log",
      out_file: "/var/log/rasokart/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
