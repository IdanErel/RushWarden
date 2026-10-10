import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * packages/sim is deterministic and integer-only (GDD section 3, determinism contract).
 * These rules make the common ways of breaking that contract a lint error.
 * Integer division goes through `idiv` in packages/sim/src/math.ts, the one file allowed to use `/`.
 */
const simDeterminism = {
  files: ['packages/sim/src/**/*.ts'],
  rules: {
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: 'Use the round PRNG (xoshiro128**).' },
      { object: 'Math', property: 'sqrt', message: 'Floating point is banned in packages/sim.' },
      { object: 'Math', property: 'pow', message: 'Floating point is banned in packages/sim.' },
      { object: 'Math', property: 'sin', message: 'Floating point is banned in packages/sim.' },
      { object: 'Math', property: 'cos', message: 'Floating point is banned in packages/sim.' },
      ...[
        'tan',
        'asin',
        'acos',
        'atan',
        'atan2',
        'sinh',
        'cosh',
        'tanh',
        'asinh',
        'acosh',
        'atanh',
        'exp',
        'expm1',
        'log',
        'log1p',
        'log2',
        'log10',
        'cbrt',
        'hypot',
        'fround',
        'round',
        'floor',
        'ceil',
        'PI',
        'E',
        'SQRT2',
        'LN2',
        'LN10',
      ].map((property) => ({
        object: 'Math',
        property,
        message: 'Floating point is banned in packages/sim (use integer math in ./math.ts).',
      })),
      {
        object: 'Number',
        property: 'parseFloat',
        message: 'Floating point is banned in packages/sim.',
      },
      { object: 'Date', property: 'now', message: 'The sim must not read the clock.' },
      { object: 'performance', property: 'now', message: 'The sim must not read the clock.' },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'Date', message: 'The sim must not read the clock.' },
      { name: 'performance', message: 'The sim must not read the clock.' },
      { name: 'crypto', message: 'Use the round PRNG.' },
      { name: 'parseFloat', message: 'Floating point is banned in packages/sim.' },
      { name: 'window', message: 'No DOM in packages/sim.' },
      { name: 'document', message: 'No DOM in packages/sim.' },
      { name: 'Float32Array', message: 'Floating point is banned in packages/sim.' },
      { name: 'Float64Array', message: 'Floating point is banned in packages/sim.' },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: "BinaryExpression[operator='/']",
        message: 'Use idiv() from ./math.ts; floating point is banned in packages/sim.',
      },
      {
        selector: "AssignmentExpression[operator='/=']",
        message: 'Use idiv() from ./math.ts; floating point is banned in packages/sim.',
      },
      {
        selector: "BinaryExpression[operator='**']",
        message: 'Exponentiation can produce floats; write an integer loop.',
      },
      {
        selector: 'Literal[raw=/^\\d*\\.\\d|^\\d+[eE]/]',
        message: 'Non-integer numeric literals are banned in packages/sim.',
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  simDeterminism,
  {
    // Hot loops over typed arrays under noUncheckedIndexedAccess: `!` after a bounds-checked index
    // is allowed in the sim and in tests; the Reviewer checks each use is actually in bounds.
    files: ['packages/sim/**/*.ts', '**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['packages/sim/src/math.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  prettier,
);
