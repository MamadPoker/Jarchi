// ESLint's own recommended rules only: catches bugs (undefined names, unreachable code), leaves the look to Prettier.
// No typescript-eslint: the code is plain JS, and it doesn't support TypeScript 7 anyway (docs/adr/0002).
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'data/', 'dist/', '.wrangler/', 'graphify-out/', '.codegraph/', 'assets/'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }], // catch {}: "can't, and that's fine" (localStorage, a closed socket)
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }], // Express knows an error handler by its 4 arguments
      'no-redeclare': ['error', { builtinGlobals: false }], // a top-level let open / viewport in a classic script is fine
      'no-unexpected-multiline': 'off', // Prettier puts a long chain's [key]() on its own line (eslint-config-prettier turns it off too)
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // The panel and the overlays: classic <script> tags in the browser. Globals: socket.io's client (io), widgets/alerts/sounds.js (JarchiSounds).
    // open: off, because the panel's own top-level `let open` (widget pages open now) is what it means, not window.open.
    files: ['panel/**/*.js', 'widgets/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, io: 'readonly', JarchiSounds: 'readonly', open: 'off' } },
  },
  {
    files: ['relay/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.serviceworker, WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly' } }, // Cloudflare's own
  },
];
