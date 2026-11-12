// ESLint's own recommended rules only: catches bugs (undefined names, unreachable code), leaves the look to Prettier.
// No typescript-eslint: the code is plain JS, and it doesn't support TypeScript 7 anyway (docs/adr/0002).
const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');
const js = require('@eslint/js');
const globals = require('globals');

const UNUSED = { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }; // Express knows an error handler by its 4 arguments

// The panel's scripts share one global scope (panel/index.html loads them in order), so each one's top-level names are
// the others' globals: a const or function read-only, a let writable. A name none of them declares is still an error.
const panelScripts = [...fs.readFileSync(path.join(__dirname, 'panel/index.html'), 'utf8').matchAll(/<script src="(js\/[\w-]+\.js)">/g)].map((m) =>
  path.join(__dirname, 'panel', m[1]),
);
const names = (p) =>
  p.type === 'Identifier'
    ? [p.name]
    : p.type === 'ObjectPattern'
      ? p.properties.flatMap((x) => names(x.value ?? x.argument))
      : p.type === 'ArrayPattern'
        ? p.elements.filter(Boolean).flatMap(names)
        : p.type === 'AssignmentPattern'
          ? names(p.left)
          : p.type === 'RestElement'
            ? names(p.argument)
            : [];
const panelGlobals = Object.fromEntries(
  panelScripts.flatMap((f) =>
    espree
      .parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest' })
      .body.flatMap((n) =>
        n.type === 'VariableDeclaration'
          ? n.declarations.flatMap((d) => names(d.id)).map((x) => [x, n.kind === 'let' ? 'writable' : 'readonly'])
          : n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration'
            ? [[n.id.name, 'readonly']]
            : [],
      ),
  ),
);
// Socket.io's client (io), widgets/alerts/sounds.js (JarchiSounds). open: off, because the panel's own top-level
// `let open` (widget pages open now) is what it means, not window.open.
const browser = { ...globals.browser, io: 'readonly', JarchiSounds: 'readonly', open: 'off' };

module.exports = [
  { ignores: ['node_modules/', 'data/', 'dist/', '.wrangler/', 'graphify-out/', '.codegraph/', 'assets/', '.playwright-mcp/'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }], // catch {}: "can't, and that's fine" (localStorage, a closed socket)
      'no-unused-vars': ['error', UNUSED],
      'no-redeclare': ['error', { builtinGlobals: false }], // a top-level let open / viewport in a classic script is fine
      'no-unexpected-multiline': 'off', // Prettier puts a long chain's [key]() on its own line (eslint-config-prettier turns it off too)
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // The overlays: classic <script> tags in the browser.
    files: ['widgets/**/*.js'],
    languageOptions: { sourceType: 'script', globals: browser },
  },
  {
    // The panel: a top-level name used only by another of its files isn't unused (vars: local), and one only another
    // file assigns (start.js: S, settings...) isn't unassigned.
    files: ['panel/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...browser, ...panelGlobals } },
    rules: { 'no-unused-vars': ['error', { ...UNUSED, vars: 'local' }], 'no-unassigned-vars': 'off' }, // start.js assigns the shared lets
  },
  {
    files: ['relay/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.serviceworker, WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly' } }, // Cloudflare's own
  },
];
