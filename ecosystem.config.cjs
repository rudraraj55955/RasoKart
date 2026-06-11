/**
 * PM2 Ecosystem Config — RasoKart API Server
 *
 * SETUP ON VPS:
 *   1. After git pull, edit this file and fill in DATABASE_URL + SESSION_SECRET
 *   2. If your DB password contains special chars (e.g. @), URL-encode them:
 *        @ → %40   # → %23   % → %25   : → %3A   / → %2F
 *      Example: postgresql://rasokart:Pass%40word@localhost:5432/rasokart
 *   3. Generate SESSION_SECRET:
 *        node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
 *   4. Run: pm2 start ecosystem.config.cjs && pm2 save
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
        PORT: 3000,
        DATABASE_URL: "postgresql://rasokart:CHANGE_THIS@localhost:5432/rasokart",
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
