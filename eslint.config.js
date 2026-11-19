// eslint for every JS file, plain ESM under GJS, with the project's code rules of ADR-002 §5
// (Scan S0-1): they read the syntax tree, so another spelling of the same call is still
// caught. tools/lint.sh runs this, then the rules grep does well (layer imports, the vendored
// lexer's hash, schemas, metadata).

import js from '@eslint/js';

const SHIPPED = ['extension.js', 'prefs.js', 'lib/**/*.{js,mjs,cjs}', 'worker/**/*.{js,mjs,cjs}'];

const LOGGING = 'logging only through lib/adapters/log.js (G3)';
const EVAL = 'no eval, new Function, ByteArray or legacy imports';
const MARKUP = 'markup only in lib/shell/markup.js';
const SYNC = 'no sync I/O or spawn: use the _async variant, with argv, never a command line';
const FDS = 'no fd may stay open into a child (N1)';
const SPIN = 'never await Promise.resolve(): it lets no GLib event in, and a loop on it hangs the shell (Scan S3-5)';

const restrictedGlobals = [
    ...['console', 'log', 'logError', 'print', 'printerr'].map(name => ({name, message: LOGGING})),
    ...['eval', 'Function', 'ByteArray', 'imports'].map(name => ({name, message: EVAL})),
];

const restrictedProperties = [
    ...['console', 'log', 'logError', 'print', 'printerr'].map(property => ({object: 'globalThis', property, message: LOGGING})),
    ...['eval', 'Function', 'ByteArray', 'imports'].map(property => ({object: 'globalThis', property, message: EVAL})),
];

const syncSyntax = [{
    selector: 'CallExpression[callee.property.name=/^(load_contents|replace_contents|query_info|query_exists|query_file_type|make_directory(_with_parents)?|make_symbolic_link|trash|enumerate_children|file_get_contents|file_set_contents|mkdir_with_parents|spawn_command_line_(a)?sync|spawn_sync|.*_sync)$/]',
    message: SYNC,
}, {
    selector: 'Identifier[name=/^(take_fd|take_stdin_fd|take_stdout_fd|take_stderr_fd|LEAVE_DESCRIPTORS_OPEN|G_SPAWN_LEAVE_DESCRIPTORS_OPEN|INHERIT_FDS)$/]',
    message: FDS,
}, {
    selector: "AwaitExpression > CallExpression[callee.object.name='Promise'][callee.property.name='resolve']",
    message: SPIN,
}];

// `use_markup: false` stays allowed: it is the safe setting, needed where GTK parses markup
// by default.
const MARKUP_PROPERTY = '/^(use_markup|useMarkup)$/';
const markupSyntax = [
    'Identifier[name=/^(useBodyMarkup|set_markup)$/]',
    `AssignmentExpression[left.property.name=${MARKUP_PROPERTY}]:not([right.value=false])`,
    `Property[key.name=${MARKUP_PROPERTY}]:not([value.value=false])`,
    'Property[key.value=/^use[-_]markup$/]:not([value.value=false])',
    'MemberExpression[computed=true][property.value=/^(set_markup|set_use_markup|useBodyMarkup)$/]',
    'AssignmentExpression[left.property.name="markup"]',
    'CallExpression[callee.property.name="set_use_markup"]:not([arguments.0.value=false])',
    'CallExpression[callee.property.name="set_property"][arguments.0.value=/^use[-_]markup$/]:not([arguments.1.value=false])',
].map(selector => ({selector, message: MARKUP}));

export default [
    {ignores: ['.cache/', 'dist/', 'node_modules/', 'lib/vendor/']},
    {files: ['**/*.{js,mjs,cjs}']},
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {global: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly'},
        },
        rules: {
            'eqeqeq': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
        },
    },
    {
        files: SHIPPED,
        rules: {
            'no-restricted-globals': ['error', ...restrictedGlobals],
            'no-restricted-properties': ['error', ...restrictedProperties],
            'no-restricted-syntax': ['error', ...syncSyntax, ...markupSyntax],
        },
    },
    {
        files: ['lib/adapters/log.js'],
        languageOptions: {globals: {console: 'readonly'}},
        rules: {'no-restricted-globals': ['error', ...restrictedGlobals.filter(g => g.name !== 'console')]},
    },
    {
        files: ['lib/shell/markup.js'],
        rules: {'no-restricted-syntax': ['error', ...syncSyntax]},
    },
    {
        // The test runner and the tools run under plain gjs, outside the shell.
        files: ['test/**', 'tools/**'],
        languageOptions: {globals: {ARGV: 'readonly', console: 'readonly', print: 'readonly', printerr: 'readonly'}},
    },
];
