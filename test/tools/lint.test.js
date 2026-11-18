// tools/lint.sh fails on each rule of ADR-002 §5: one broken file at a time, in a copy of
// the parts of the repo it reads.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {test, assertEqual} from '../harness.js';

const repo = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();

function write(dir, path, text) {
    const file = Gio.File.new_build_filenamev([dir, path]);
    GLib.mkdir_with_parents(file.get_parent().get_path(), 0o755);
    file.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);
}

/** Runs lint.sh on a tree with the repo's metadata and schemas plus the given files. */
function lint(files) {
    const dir = GLib.dir_make_tmp('headsup-lint-XXXXXX');
    for (const path of ['metadata.json', 'schemas/org.gnome.shell.extensions.headsup.gschema.xml'])
        write(dir, path, new TextDecoder().decode(repo.get_child(path).load_contents(null)[1]));
    for (const [path, text] of Object.entries(files))
        write(dir, path, text);
    const [, , stderr, status] = GLib.spawn_sync(null, ['sh', repo.get_child('tools/lint.sh').get_path(), dir],
        null, GLib.SpawnFlags.SEARCH_PATH, null);
    GLib.spawn_sync(null, ['rm', '-rf', dir], null, GLib.SpawnFlags.SEARCH_PATH, null);
    return {ok: status === 0, errors: new TextDecoder().decode(stderr)};
}

const broken = [
    ['gi:// in core', 'lib/core/a.js', "import GLib from 'gi://GLib';", 'no gi:// imports in lib/core'],
    ['St in adapters', 'lib/adapters/a.js', "import St from 'gi://St';", 'no shell libraries'],
    ['shell resource in the worker', 'worker/main.js', "import * as Main from 'resource:///org/gnome/shell/ui/main.js';", 'no shell libraries'],
    ['Gtk in the shell', 'lib/shell/a.js', "import Gtk from 'gi://Gtk';", 'no GTK'],
    ['sync spawn', 'lib/adapters/a.js', 'GLib.spawn_command_line_sync("ls");', 'no sync I/O'],
    ['sync read', 'lib/shell/a.js', 'GLib.file_get_contents(path);', 'no sync I/O'],
    ['sync load_contents', 'extension.js', 'file.load_contents(null);', 'no sync I/O'],
    ['markup outside markup.js', 'lib/shell/a.js', 'label.clutter_text.set_markup(text);', 'markup only'],
    ['body markup', 'lib/shell/notifier.js', 'n.useBodyMarkup = true;', 'markup only'],
    ['console outside log.js', 'lib/core/a.js', 'console.log(text);', 'logging only'],
    ['bare log()', 'lib/shell/a.js', 'log(text);', 'logging only'],
    ['logError', 'prefs.js', 'logError(e);', 'logging only'],
    ['D-Bus name', 'lib/adapters/a.js', 'Gio.bus_own_name(1, "x", 0, null, null, null);', 'no inbound surfaces'],
    ['Soup.Server', 'lib/adapters/a.js', 'new Soup.Server();', 'no inbound surfaces'],
    ['TLS override', 'lib/adapters/a.js', "msg.connect('accept-certificate', () => true);", 'no TLS overrides'],
    ['eval', 'lib/core/a.js', 'eval(text);', 'no eval'],
    ['new Function', 'lib/core/a.js', 'new Function(text);', 'no eval'],
    ['ByteArray', 'lib/adapters/a.js', 'ByteArray.toString(b);', 'no eval'],
    // Scan, slice 0 audit: each of these passes lint.sh today.
    ['logging through globalThis', 'lib/core/a.js', 'globalThis.log(prompt);', 'logging only'],
    ['console taken apart', 'lib/core/a.js', 'const {warn} = console; warn(text);', 'logging only'],
    ['print through globalThis', 'lib/core/a.js', 'globalThis.print(token);', 'logging only'],
    ['eval through globalThis', 'lib/core/a.js', 'globalThis.eval(text);', 'no eval'],
    ['Function without new', 'lib/core/a.js', "Function('return ' + text)();", 'no eval'],
    ['camelCase markup', 'lib/shell/a.js', 'label.clutter_text.useMarkup = true;', 'markup only'],
    ['markup by property name', 'lib/shell/a.js', "label.clutter_text.set_property('use-markup', true);", 'markup only'],
    ['shell command line', 'lib/shell/a.js', 'GLib.spawn_command_line_async(`xdg-open ${url}`);', 'no sync I/O'],
    ['sync replace_contents', 'lib/adapters/a.js', 'file.replace_contents(bytes, null, false, 0, null);', 'no sync I/O'],
    ['sync make_directory', 'lib/adapters/a.js', 'file.make_directory(null);', 'no sync I/O'],
    ['sync query_info', 'lib/adapters/a.js', "file.query_info('standard::*', 0, null);", 'no sync I/O'],
    ['sync enumerate_children', 'lib/adapters/a.js', "file.enumerate_children('*', 0, null);", 'no sync I/O'],
    ['sync file_set_contents', 'lib/adapters/a.js', 'GLib.file_set_contents(path, data);', 'no sync I/O'],
    ['markup turned on in prefs', 'prefs.js', 'export const on = row => row.set_use_markup(true);', 'markup only'],
    ['markup turned on by property', 'prefs.js', 'export const row = A => new A({use_markup: true});', 'markup only'],
    ['markup by a quoted property', 'prefs.js', "export const row = A => new A({'use-markup': true});", 'markup only'],
    ['markup by a computed name', 'lib/shell/a.js', "export const show = (label, t) => label.clutter_text['set_markup'](t);", 'markup only'],
    ['an .mjs file', 'lib/core/a.mjs', 'console.log(secret);', 'logging only'],
    ['marked changed', 'lib/vendor/marked.esm.js', 'export const marked = 1;', 'SHA-256'],
    ['bad schema', 'schemas/org.gnome.shell.extensions.headsup.gschema.xml', '<schemalist><schema id="x"><key name="Bad_Key" type="b"><default>false</default></key></schema></schemalist>', 'glib-compile-schemas'],
    ['metadata version', 'metadata.json', '{"shell-version": ["48", "49", "50", "51"], "version": 3}', 'metadata.json'],
    ['metadata shells', 'metadata.json', '{"shell-version": ["48"]}', 'metadata.json'],
];

test('a clean tree passes', () => {
    assertEqual(lint({}).ok, true);
});

test('allowed: log.js logs, markup.js marks up, prefs use GTK and turn markup off, tests own servers', () => {
    const r = lint({
        'lib/adapters/log.js': 'export const write = line => console.warn(line);',
        'lib/shell/markup.js': 'export const show = (label, escaped) => label.clutter_text.set_markup(escaped);',
        'prefs.js': "import Adw from 'gi://Adw';\nexport const row = () => {\n    const r = new Adw.ActionRow({use_markup: false});\n    r.set_use_markup(false);\n    return r;\n};",
        'lib/shell/a.js': "export class A {\n    #log() {}\n    run(x, file, catalog, map) {\n        this.#log('code');\n        catalog(x);\n        map.delete(x);\n        file.load_contents_async(null, null);\n    }\n}",
        'test/server.js': "import Soup from 'gi://Soup';\nexport const s = new Soup.Server();",
    });
    assertEqual(r.errors, '');
});

for (const [name, path, text, message] of broken) {
    test(`fails: ${name}`, () => {
        const r = lint({[path]: text});
        assertEqual([r.ok, r.errors.includes(message)], [false, true], r.errors);
    });
}
