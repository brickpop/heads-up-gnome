// `just doctor`: checks the machine HeadsUp runs on (ADR-002 §9). Run it on a GNOME
// desktop, as the user who will use HeadsUp. Prints one line per check and fails when a
// check that HeadsUp needs fails.
//   tools/gjs.sh gjs -m tools/doctor.js

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

let failed = false;

function report(ok, what, detail = '', needed = true) {
    print(`${ok ? 'ok  ' : needed ? 'FAIL' : 'warn'} ${what}${detail ? `: ${detail}` : ''}`);
    if (!ok && needed)
        failed = true;
}

/** Runs argv and returns [ok, trimmed stdout and stderr]. */
function run(argv) {
    try {
        const [, out, err, status] = GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
        const text = new TextDecoder().decode(out).trim() || new TextDecoder().decode(err).trim();
        return [status === 0, text];
    } catch (error) {
        return [false, error.message];
    }
}

const shell = run(['gnome-shell', '--version']);
const major = Number(shell[1].match(/(\d+)\./)?.[1]);
report(shell[0] && major >= 48 && major <= 51, 'GNOME Shell 48–51', shell[1]);
report(true, 'gjs', `${Math.floor(System.version / 10000)}.${Math.floor(System.version / 100) % 100}.${System.version % 100}`);
for (const [tool, args] of [['node', ['--version']], ['python3', ['--version']], ['glib-compile-schemas', ['--version']]]) {
    const [ok, text] = run([tool, ...args]);
    report(ok, tool, text, tool !== 'glib-compile-schemas' || ok);
}

// Typelibs: Secret, ECal and the others turn their feature off when missing.
for (const [name, version, pkg] of [
    ['Soup', '3.0', 'libsoup3'], ['Secret', '1', 'libsecret'], ['ECal', '2.0', 'evolution-data-server'],
    ['EDataServer', '1.2', 'evolution-data-server'], ['ICalGLib', '3.0', 'libical'],
    ['GdkPixbuf', '2.0', 'gdk-pixbuf2'], ['Adw', '1', 'libadwaita'],
]) {
    let ok = true;
    try {
        await import(`gi://${name}?version=${version}`);
    } catch {
        ok = false;
    }
    report(ok, `typelib ${name}-${version}`, ok ? '' : `install ${pkg}`, false);
}

// A service scope, as slice 3 and the worker start them: PartOf the session, and a memory
// limit that the user's systemd really enforces (Scan N5).
const unit = `headsup-doctor-${GLib.random_int()}.scope`;
const [scopeOk, scopeOut] = run(['systemd-run', '--user', '--scope', '--quiet', '--collect', `--unit=${unit}`,
    '-p', 'PartOf=graphical-session.target', '-p', 'MemoryMax=512M', '-p', 'TimeoutStopSec=3', '--',
    'sh', '-c', `cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max"; systemctl --user show -p PartOf --value ${unit}`]);
const [memoryMax, partOf] = scopeOut.split('\n');
report(scopeOk, 'systemd user scope starts and stops', scopeOk ? '' : scopeOut);
if (scopeOk) {
    report(memoryMax === String(512 * 1024 * 1024), 'scope memory limit enforced (MemoryMax=512M)', `memory.max = ${memoryMax}`);
    report(partOf?.includes('graphical-session.target'), 'scope stops with the session (PartOf=graphical-session.target)', partOf ?? '');
}

const hasName = (bus, name) => {
    try {
        const reply = Gio.DBus[bus].call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListActivatableNames', null, null, Gio.DBusCallFlags.NONE, 2000, null).deepUnpack()[0];
        const owned = Gio.DBus[bus].call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, 2000, null).deepUnpack()[0];
        return reply.includes(name) || owned.includes(name);
    } catch {
        return false;
    }
};
report(hasName('session', 'org.freedesktop.secrets'), 'Secret Service (GNOME Keyring), for API tokens', '', false);
report(hasName('system', 'org.freedesktop.UPower'), 'UPower, for "only on power adapter"', '', false);

const terminals = [
    ['org.gnome.Ptyxis', 'ptyxis'], ['org.gnome.Console', 'kgx'], ['org.gnome.Terminal', 'gnome-terminal'],
    ['kitty', 'kitty'], ['Alacritty', 'alacritty'], ['org.wezfurlong.wezterm', 'wezterm'],
    ['com.mitchellh.ghostty', 'ghostty'], ['foot', 'foot'],
].filter(([id, program]) => Gio.DesktopAppInfo.new(`${id}.desktop`) && GLib.find_program_in_path(program))
    .map(([id]) => Gio.DesktopAppInfo.new(`${id}.desktop`).get_name());
report(terminals.length > 0, 'terminals for Commands', terminals.join(', ') || 'none found', false);

System.exit(failed ? 1 : 0);
