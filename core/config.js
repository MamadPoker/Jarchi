// The one place for runtime config. Electron can set JARCHI_DATA_DIR (e.g. to app.getPath('userData')) before requiring the server.
const os = require('node:os');
const path = require('node:path');

try {
  process.loadEnvFile();
} catch {} // .env is optional

const DATA_DIR = path.resolve(process.env.JARCHI_DATA_DIR || path.join(__dirname, '..', 'data'));
// A test copy: under the test runner (node --test), with JARCHI_TEST=1, or with its data folder in the temp folder (a
// scratch copy). It never talks to Jarchi's own relay (connectors/kick-account.js RELAY), so its usage pings, tickets
// and the rest never reach Jarchi Admin. (A path on another drive comes back absolute: not inside.)
const inTemp = path.relative(os.tmpdir(), DATA_DIR);
const TEST = !!process.env.NODE_TEST_CONTEXT || process.env.JARCHI_TEST === '1' || !(inTemp.startsWith('..') || path.isAbsolute(inTemp));

module.exports = {
  HOST: '127.0.0.1',
  PORT: Number(process.env.JARCHI_PORT) || 3000,
  DATA_DIR,
  UPLOADS_DIR: path.join(DATA_DIR, 'uploads'),
  TEST,
};
