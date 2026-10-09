// The one place for runtime config. Electron can set JARCHI_DATA_DIR (e.g. to app.getPath('userData')) before requiring the server.
const path = require('node:path');

try { process.loadEnvFile(); } catch {} // .env is optional

const DATA_DIR = path.resolve(process.env.JARCHI_DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = {
  HOST: '127.0.0.1',
  PORT: Number(process.env.JARCHI_PORT) || 3000,
  DATA_DIR,
  UPLOADS_DIR: path.join(DATA_DIR, 'uploads'),
};
