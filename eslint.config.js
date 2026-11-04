const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-plugin-prettier/recommended');

module.exports = [
  {ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/modernizr-custom.min.js', 'src/service-worker.js', 'src/precache-config.js']},
  js.configs.recommended,
  {
    files: ['src/scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {...globals.browser, gtag: 'readonly'},
    },
  },
  prettier,
  {
    rules: {
      // Pre-existing code smells, surfaced as warnings rather than blockers
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-constant-binary-expression': 'warn',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'prettier/prettier': [
        'error',
        {
          useTabs: false,
          printWidth: 80,
          tabWidth: 2,
          singleQuote: true,
          trailingComma: 'all',
          bracketSpacing: false,
          arrowParens: 'avoid',
        },
      ],
    },
  },
];
