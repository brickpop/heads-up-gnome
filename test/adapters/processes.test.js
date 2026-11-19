// The processes adapter with real child processes, but without systemd-run (the sandbox has
// no user manager): `argv` runs the shell directly, as the scope would after its exec.

import {test, assertEqual, assertThrows} from '../harness.js';
import {expandHome, pickShell, processes, scopeArgv} from '../../lib/adapters/processes.js';
import {portsOf} from '../../lib/adapters/portProbe.js';
import {ownScope} from '../../lib/adapters/scopes.js';

const ID = '0b6c3a52-6f43-4bb5-9f11-2f0f3d7c9a10';
const stopped = [];
const direct = (_unit, shell, command) => [shell, '-c', command];
const procs = () => processes({log: () => {}, argv: direct, scopes: {stopUnit: unit => stopped.push(unit), stopAll: async () => 0}});

async function readAll(output) {
    const chunks = [];
    for (;;) {
        await new Promise(resolve => output.whenReadable(resolve));
        const chunk = await output.read(64 * 1024);
        if (!chunk)
            return chunks.join('');
        chunks.push(new TextDecoder().decode(chunk));
    }
}

const start = (command, extra = {}) => procs().start({id: ID, command, cwd: '/tmp', env: [], shell: '/bin/sh', ...extra});

test('N1: a service sees only fds 0, 1 and 2 (plus ls\'s own)', async () => {
    const run = start('ls /proc/self/fd');
    const fds = (await readAll(run.output)).split('\n').filter(Boolean).map(Number).sort((a, b) => a - b);
    await run.exited;
    // ls opens the folder it lists: one more fd, its own.
    assertEqual(fds.length <= 4 && fds.slice(0, 3).join() === '0,1,2', true, `fds ${fds}`);
});

test('the env is set on the launcher, never in argv; stdout and stderr are merged; cwd and the exit code', async () => {
    const run = start('echo "$SECRET_TOKEN"; pwd; echo oops >&2; exit 3', {env: [{key: 'SECRET_TOKEN', value: 's3cr3t'}]});
    assertEqual(await readAll(run.output), 's3cr3t\n/tmp\noops\n');
    assertEqual(await run.exited, {code: 3});
    const line = scopeArgv(`headsup-${ID}-a1b2c3d4.scope`, '/bin/bash', 'npm run dev');
    assertEqual(line.join(' ').includes('s3cr3t'), false);
    assertEqual(line.slice(-4), ['/bin/bash', '-l', '-c', 'npm run dev']);
    assertEqual(line.includes('PartOf=graphical-session.target') && line.includes(`--unit=headsup-${ID}-a1b2c3d4.scope`), true);
});

test('a killed service reports its signal; stop() stops its own scope, with a new run name each start', async () => {
    const run = start('kill -TERM $$; sleep 5');
    assertEqual(await run.exited, {signal: 15});
    run.stop();
    assertEqual([stopped.at(-1), new RegExp(`^headsup-${ID}-[0-9a-f]{8}\\.scope$`).test(run.unit)], [run.unit, true]);
    const again = start('true');
    await again.exited;
    assertEqual(again.unit === run.unit, false);
});

test('G10: an id that isn\'t a UUID or a bad env key never reach a unit or the launcher', () => {
    assertThrows(() => start('true', {id: '../../evil'}), 'id');
    assertThrows(() => start('true', {env: [{key: 'A=B', value: '1'}]}), 'env key');
});

test('only HeadsUp\'s own scopes can be stopped by name', () => {
    assertEqual([ownScope(`headsup-${ID}-a1b2c3d4.scope`), ownScope('gnome-shell.scope'), ownScope('headsup-x.scope'), ownScope(`headsup-${ID}-a1b2c3d4.service`)],
        [true, false, false, false]);
});

test('the shell comes from SHELL when supported, else bash; ~ is the home folder', () => {
    assertEqual(pickShell('/bin/bash'), {shell: '/bin/bash', fallback: null});
    assertEqual(pickShell('/usr/local/bin/zsh-not-there/zsh'), {shell: '/bin/bash', fallback: 'zsh'}, 'not an existing file');
    assertEqual(pickShell('/usr/bin/fish'), {shell: '/bin/bash', fallback: 'fish'});
    assertEqual(pickShell('zsh'), {shell: '/bin/bash', fallback: 'zsh'}, 'not an absolute path');
    assertEqual(pickShell(null), {shell: '/bin/bash', fallback: null});
    assertEqual(procs().loginShell().shell.startsWith('/'), true);
    assertEqual([expandHome('~', '/home/me'), expandHome('~/code', '/home/me'), expandHome('/srv', '/home/me'), expandHome('~x', '/home/me')],
        ['/home/me', '/home/me/code', '/srv', '~x']);
});

test('ports: ss lines whose process is one of the scope\'s, lowest first', () => {
    const ss = [
        'LISTEN 0 4096 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=200,fd=7))',
        'LISTEN 0 511 *:3000 *:* users:(("node",pid=101,fd=20))',
        'LISTEN 0 511 [::]:3001 [::]:* users:(("node",pid=102,fd=21),("node",pid=101,fd=22))',
        'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*',
    ].join('\n');
    assertEqual(portsOf(ss, new Set([101])), [3000, 3001]);
    assertEqual(portsOf(ss, new Set([999])), []);
});

test('files: a folder is a folder, ~ is the home folder, a file or nothing isn\'t', async () => {
    const {files} = await import('../../lib/adapters/files.js');
    const f = files();
    assertEqual([await f.isFolder('/tmp'), await f.isFolder('~'), await f.isFolder('/etc/passwd'), await f.isFolder('/nowhere/at/all')], [true, true, false, false]);
});

test('SHELL=/tmp/x/bash: an executable the user named bash is accepted, since the user owns SHELL (Scan S3-3)', async () => {
    const GLib = (await import('gi://GLib')).default;
    const dir = GLib.dir_make_tmp('headsup-shell-XXXXXX');
    const fake = `${dir}/bash`;
    GLib.spawn_sync(null, ['sh', '-c', `printf '#!/bin/sh\\n' > ${fake}; chmod 755 ${fake}`], null, GLib.SpawnFlags.SEARCH_PATH, null);
    assertEqual(pickShell(fake), {shell: fake, fallback: null});
    GLib.spawn_sync(null, ['chmod', '644', fake], null, GLib.SpawnFlags.SEARCH_PATH, null);
    assertEqual(pickShell(fake), {shell: '/bin/bash', fallback: 'bash'}, 'not executable');
    GLib.spawn_sync(null, ['rm', '-rf', dir], null, GLib.SpawnFlags.SEARCH_PATH, null);
});
