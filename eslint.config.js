// ESLint (flat config). Run with:  npm run lint   (from the tests/ folder, after npm install)
// The app is plain <script> files that share one global scope (so it works from file://).
// To still catch typos and missing functions, the names each file declares at the top level
// are collected here (by parsing the files) and handed to the others as globals.
const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');
const espree = require('espree');

const APP_FILES = ['ui.js', 'event.config.js', 'setup.js', 'app.js', 'projector.js', 'alloc.js'];
const shared = {};
for (const f of APP_FILES) {
  const ast = espree.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'), { ecmaVersion: 2022, sourceType: 'script' });
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') shared[node.id.name] = 'writable';
    if (node.type === 'VariableDeclaration') node.declarations.forEach(d => d.id.type === 'Identifier' && (shared[d.id.name] = 'writable'));
  }
}

module.exports = [
  { ignores: ['vendor/**', '**/node_modules/**', 'eslint.config.js'] },
  js.configs.recommended,
  {
    files: APP_FILES,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, jspdf: 'readonly', ...shared },
    },
    rules: {
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      'no-redeclare': 'off', // each file's own top-level names are also in the shared list
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser, ...shared } },
  },
];
