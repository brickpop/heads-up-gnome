// tools/pack.py (G12): tracked files under the shipped paths only, no symlinks.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {test, assertEqual} from '../harness.js';

const repo = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();
const decode = bytes => new TextDecoder().decode(bytes);

function run(argv, cwd) {
    const [, stdout, stderr, status] = GLib.spawn_sync(cwd, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
    return {ok: status === 0, out: decode(stdout), err: decode(stderr)};
}

/** A throwaway git repo with these files committed, and `extra` left untracked. */
function tree(files, extra = {}) {
    const dir = GLib.dir_make_tmp('headsup-pack-XXXXXX');
    const write = (path, text) => {
        const file = Gio.File.new_build_filenamev([dir, path]);
        GLib.mkdir_with_parents(file.get_parent().get_path(), 0o755);
        if (text.startsWith('->'))
            file.make_symbolic_link(text.slice(2), null);
        else
            file.replace_contents(new TextEncoder().encode(`${text}\n`), null, false, Gio.FileCreateFlags.NONE, null);
    };
    Object.entries(files).forEach(([path, text]) => write(path, text));
    const git = (...args) => run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], dir);
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'files');
    Object.entries(extra).forEach(([path, text]) => write(path, text));
    return dir;
}

const pack = dir => run(['python3', repo.get_child('tools/pack.py').get_path(), dir], null);
const remove = dir => run(['rm', '-rf', dir], null);

test('packs tracked shipped files only, with version-name, same bytes twice', () => {
    const dir = tree({
        'metadata.json': '{"uuid": "headsup@brickpop.app"}',
        'extension.js': '',
        'lib/core/a.js': '',
        'schemas/x.gschema.xml': '<schemalist/>',
        'test/a.test.js': '',
        'README.md': '',
        'icons/README.md': 'licences',
        'icons/timer-symbolic.svg': '<svg/>',
    }, {'lib/core/untracked.js': ''});
    const r = pack(dir);
    assertEqual(r.out.split('\n').filter(l => l && !l.startsWith('->')),
        ['extension.js', 'icons/timer-symbolic.svg', 'lib/core/a.js', 'metadata.json', 'schemas/x.gschema.xml'], r.err);
    const zip = `${dir}/dist/headsup@brickpop.app.shell-extension.zip`;
    const metadata = run(['python3', '-c', `import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read("metadata.json").decode())`, zip], null);
    assertEqual(JSON.parse(metadata.out)['version-name'].startsWith('dev '), true, metadata.out);
    const first = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, Gio.File.new_for_path(zip).load_bytes(null)[0]);
    pack(dir);
    const second = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, Gio.File.new_for_path(zip).load_bytes(null)[0]);
    assertEqual(first, second, 'reproducible');
    remove(dir);
});

test('a tagged commit gives its version', () => {
    const dir = tree({'metadata.json': '{}'});
    run(['git', '-c', 'tag.gpgsign=false', 'tag', 'v1.2.3'], dir);
    pack(dir);
    const zip = `${dir}/dist/headsup@brickpop.app.shell-extension.zip`;
    const metadata = run(['python3', '-c', `import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read("metadata.json").decode())`, zip], null);
    assertEqual(JSON.parse(metadata.out)['version-name'], '1.2.3');
    remove(dir);
});

test('refuses a tracked symlink, even to a file inside the repo', () => {
    for (const target of ['/etc/passwd', 'a.js']) {
        const dir = tree({'metadata.json': '{}', 'lib/a.js': '', 'lib/evil.js': `->${target}`});
        const r = pack(dir);
        assertEqual([r.ok, r.err.includes('lib/evil.js is a symlink')], [false, true], r.err);
        remove(dir);
    }
});

test('refuses a shipped folder that is a symlink out of the repo', () => {
    const outside = GLib.dir_make_tmp('headsup-outside-XXXXXX');
    Gio.File.new_build_filenamev([outside, 'x.js']).replace_contents(new TextEncoder().encode('\n'), null, false, 0, null);
    const dir = tree({'metadata.json': '{}', 'worker': `->${outside}`});
    const r = pack(dir);
    assertEqual([r.ok, r.err.includes('worker is a symlink')], [false, true], r.out + r.err);
    remove(dir);
    remove(outside);
});

test('refuses to pack a tracked file with uncommitted changes (Scan, slice 0 audit)', () => {
    const dir = tree({'metadata.json': '{"uuid": "headsup@brickpop.app"}', 'lib/core/a.js': 'reviewed'});
    run(['git', '-c', 'tag.gpgsign=false', 'tag', 'v9.9.9'], dir);
    Gio.File.new_build_filenamev([dir, 'lib/core/a.js']).replace_contents(
        new TextEncoder().encode('not reviewed\n'), null, false, Gio.FileCreateFlags.NONE, null);
    const r = pack(dir);
    assertEqual(r.ok, false, `a zip named 9.9.9 would ship uncommitted code: ${r.out}`);
    remove(dir);
});
