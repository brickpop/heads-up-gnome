// The `Processes` port (ADR-002 §6.4): each service runs as our child, in its own systemd
// scope, through the user's login shell. Its environment is set on the launcher, never in
// argv; stdin is /dev/null; stdout and stderr are merged into one pipe, read only when the
// core asks (the read budget, N2). Gio.Subprocess closes every fd above 2 in the child (N1).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {validEnvKey, validServiceId} from '../core/serviceDefinition.js';
import {scopes as systemdScopes} from './scopes.js';

const SHELLS = ['bash', 'zsh', 'sh', 'dash', 'ksh'];

/**
 * The shell services run in: `shell` when it is an absolute path to a regular executable file
 * named bash, zsh, sh, dash or ksh (Scan S3-3); else /bin/bash and the refused name. The user
 * owns SHELL, so an executable they named bash is accepted.
 */
export function pickShell(shell) {
    const name = (shell ?? '').split('/').pop();
    const usable = shell?.startsWith('/') && SHELLS.includes(name) &&
        GLib.file_test(shell, GLib.FileTest.IS_REGULAR) && GLib.file_test(shell, GLib.FileTest.IS_EXECUTABLE);
    return usable ? {shell, fallback: null} : {shell: '/bin/bash', fallback: name || null};
}

/**
 * The systemd-run line that starts `command` in its scope, without the env (§6.4). Tests pass
 * their own prefix, since the sandbox has no user manager.
 */
export function scopeArgv(unit, shell, command) {
    return [
        'systemd-run', '--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--description=HeadsUp service',
        '-p', 'PartOf=graphical-session.target', '-p', 'TimeoutStopSec=3', '--', shell, '-l', '-c', command,
    ];
}

/** `~` and `~/…` in a folder, on the home folder. */
export function expandHome(path, home = GLib.get_home_dir()) {
    if (path === '~')
        return home;
    return path.startsWith('~/') ? `${home}${path.slice(1)}` : path;
}

/**
 * @param {object} options
 * @param {import('../core/ports.js').Log} options.log
 * @param {typeof scopeArgv} [options.argv]  the tests' own, without systemd-run
 * @param {ReturnType<typeof systemdScopes>} [options.scopes]
 */
export function processes({log, argv = scopeArgv, scopes = systemdScopes(log)}) {
    return {
        /**
         * Starts a service, in a scope with a new run name. Throws on an id or env key that
         * breaks the rules (G10), or when it can't spawn.
         */
        start({id, command, cwd, env, shell}) {
            if (!validServiceId(id) || env.some(v => !validEnvKey(v.key)))
                throw new Error('refused: an id or environment key breaks the rules');
            // A new run name at each start, so a unit name is never reused (Rev 32).
            const unit = `headsup-${id}-${GLib.uuid_string_random().slice(0, 8)}.scope`;
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE});
            launcher.set_stdin_file_path('/dev/null');
            launcher.set_cwd(expandHome(cwd));
            for (const {key, value} of env)
                launcher.setenv(key, value, true);
            const process = launcher.spawnv(argv(unit, shell, command));
            const pipe = process.get_stdout_pipe();
            return {
                pid: Number(process.get_identifier()),
                unit,
                output: {
                    /**
                     * Calls `fn` once the pipe has data, or has ended. Disposing the handle
                     * destroys the pollable source, so none outlives disable().
                     */
                    whenReadable: fn => {
                        const source = pipe.create_source(null);
                        source.set_callback(() => {
                            fn();
                            return GLib.SOURCE_REMOVE;
                        });
                        source.attach(null);
                        return {dispose: () => source.destroy()};
                    },
                    read: max => new Promise(resolve => pipe.read_bytes_async(max, GLib.PRIORITY_DEFAULT, null, (_s, result) => {
                        try {
                            const bytes = pipe.read_bytes_finish(result);
                            resolve(bytes.get_size() ? bytes.toArray() : null);
                        } catch {
                            resolve(null);
                        }
                    })),
                },
                exited: new Promise(resolve => process.wait_async(null, () => {
                    resolve(process.get_if_exited() ? {code: process.get_exit_status()} : {signal: process.get_term_sig()});
                })),
                stop: () => scopes.stopUnit(unit),
            };
        },

        /** Stops every HeadsUp scope, known or not (N4b): at enable and disable. */
        stopAll: () => scopes.stopAll(),

        /**
         * The user's shell from SHELL (GDM sets it from the user's account, LDAP and sssd
         * included) when it is an absolute bash, zsh, sh, dash or ksh; else /bin/bash, with
         * `fallback` naming the one refused.
         */
        loginShell() {
            return pickShell(GLib.getenv('SHELL'));
        },
    };
}
