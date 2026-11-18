// The test runner, under plain gjs: runs every test/**/*.test.js, or those whose path
// contains the first argument. GSettings uses the memory backend, with our schemas and the
// GNOME fixtures compiled into a temporary folder, so nothing touches the user's settings.
//   tools/gjs.sh gjs -m test/run.js [filter]

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

import {tests} from './harness.js';

function findTests(dir, found = []) {
    const children = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    for (let info; (info = children.next_file(null));) {
        const child = dir.get_child(info.get_name());
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            findTests(child, found);
        else if (info.get_name().endsWith('.test.js'))
            found.push(child);
    }
    return found.sort((a, b) => a.get_path().localeCompare(b.get_path()));
}

/** Before anything opens GSettings. */
function useTestSettings(root) {
    const dir = GLib.dir_make_tmp('headsup-test-XXXXXX');
    const sources = [root.get_parent().get_child('schemas'), root.get_child('fixtures/gnome-schemas')];
    for (const source of sources) {
        const children = source.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info; (info = children.next_file(null));)
            source.get_child(info.get_name()).copy(Gio.File.new_build_filenamev([dir, info.get_name()]), Gio.FileCopyFlags.NONE, null, null);
    }
    const [, , , status] = GLib.spawn_sync(null, ['glib-compile-schemas', '--strict', dir], null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (status !== 0)
        throw new Error('glib-compile-schemas failed');
    GLib.setenv('GSETTINGS_SCHEMA_DIR', dir, true);
    GLib.setenv('GSETTINGS_BACKEND', 'memory', true);
    return Gio.File.new_for_path(dir);
}

function remove(dir) {
    const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    for (let info; (info = children.next_file(null));)
        dir.get_child(info.get_name()).delete(null);
    dir.delete(null);
}

async function main() {
    const root = Gio.File.new_for_uri(import.meta.url).get_parent();
    const settingsDir = useTestSettings(root);
    const filter = ARGV[0] ?? '';
    let failed = 0;
    for (const file of findTests(root).filter(f => f.get_path().includes(filter))) {
        tests.length = 0;
        await import(file.get_uri());
        for (const {name, fn} of tests) {
            try {
                await fn();
                print(`ok   ${root.get_relative_path(file)}: ${name}`);
            } catch (error) {
                failed++;
                printerr(`FAIL ${root.get_relative_path(file)}: ${name}\n     ${error.message}`);
            }
        }
    }
    remove(settingsDir);
    return failed;
}

const loop = new GLib.MainLoop(null, false);
let failures = 1;
main().then(n => (failures = n), error => printerr(`${error}\n${error.stack}`)).finally(() => loop.quit());
loop.run();
print(failures ? `${failures} failed` : 'all passed');
System.exit(failures ? 1 : 0);
