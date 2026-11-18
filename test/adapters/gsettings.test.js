// The GSettings adapters against real GSettings (memory backend, schemas compiled by run.js).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {test, assertEqual, assertThrows} from '../harness.js';
import {keyValues, gnomeKeys, toVariant} from '../../lib/adapters/gsettings.js';
import {SettingsStore} from '../../lib/core/settings.js';

const open = id => new Gio.Settings({schema_id: id});
test('keyValues: typed get and set, a tuple as an array, enums by name', () => {
    const state = keyValues(open('org.gnome.shell.extensions.headsup.state'));
    state.set('input-source-binding', [['<Super>space'], []]);
    assertEqual(state.get('input-source-binding'), [['<Super>space'], []]);
    state.set('hud-shortcut-status', 'layouts');
    assertEqual(state.get('hud-shortcut-status'), 'layouts');
    assertThrows(() => state.set('hud-shortcut-status', 'bogus'), 'enum out of range');
    assertThrows(() => state.set('welcome-done', 'yes'), 'wrong type');
    assertThrows(() => state.set('nope', true), 'unknown key');
    state.reset('hud-shortcut-status');
    state.reset('input-source-binding');
});

test('keyValues: watch sees writes by another GSettings object (the other process)', () => {
    const port = keyValues(open('org.gnome.shell.extensions.headsup'));
    const seen = [];
    const handle = port.watch(key => seen.push(key));
    open('org.gnome.shell.extensions.headsup').set_boolean('close-on-click-outside', false);
    handle.dispose();
    open('org.gnome.shell.extensions.headsup').set_boolean('close-on-click-outside', true);
    assertEqual(seen, ['close-on-click-outside']);
});

test('SettingsStore over the real schemas: every key in state, reset keeps the state', () => {
    const store = new SettingsStore({
        settings: keyValues(open('org.gnome.shell.extensions.headsup')),
        state: keyValues(open('org.gnome.shell.extensions.headsup.state')),
    });
    store.set('appearance', 'dark');
    store.set('welcome-done', true);
    store.reset();
    assertEqual([store.state.appearance, store.state['welcome-done']], ['system', true]);
    store.set('welcome-done', false);
    store.dispose();
});

test('gnomeKeys: bindings with names, custom shortcuts, input sources', () => {
    const keys = gnomeKeys();
    const media = open('org.gnome.settings-daemon.plugins.media-keys');
    const path = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/';
    const custom = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding', path});
    custom.set_string('name', 'Terminal');
    custom.set_string('binding', '<Super>t');
    media.set_strv('custom-keybindings', [path]);

    const list = keys.bindings();
    const find = key => list.find(b => b.key === key);
    assertEqual(find('switch-input-source'), {
        schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-input-source',
        name: 'Switch to next input source', accels: ['<Super>space', 'XF86Keyboard'],
    });
    assertEqual(find(path)?.name, 'Terminal');
    assertEqual(find(path)?.accels, ['<Super>t']);
    assertEqual(find('custom-keybindings'), undefined, 'the paths list is not a binding');

    assertEqual(keys.inputSourceCount(), 0);
    open('org.gnome.desktop.input-sources').set_value('sources', new GLib.Variant('a(ss)', [['xkb', 'us'], ['ibus', 'anthy']]));
    assertEqual(keys.inputSourceCount(), 2);

    media.reset('custom-keybindings');
    open('org.gnome.desktop.input-sources').reset('sources');
});

test('gnomeKeys: watch fires for bindings, sources and custom shortcuts; dispose stops it', () => {
    const keys = gnomeKeys();
    let calls = 0;
    const handle = keys.watch(() => calls++);
    const media = open('org.gnome.settings-daemon.plugins.media-keys');
    const path = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/';
    media.set_strv('custom-keybindings', [path]);
    const before = calls;
    new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding', path}).set_string('binding', '<Super>space');
    assertEqual(calls > before, true, 'a custom shortcut added later is watched');
    open('org.gnome.desktop.wm.keybindings').set_strv('close', ['<Alt>F5']);
    const now = calls;
    handle.dispose();
    open('org.gnome.desktop.wm.keybindings').reset('close');
    media.reset('custom-keybindings');
    assertEqual(calls, now, 'nothing after dispose');
});

test('gnomeKeys: writes switch-input-source only, and only valid accelerators (G8b)', () => {
    const keys = gnomeKeys();
    const wm = open('org.gnome.desktop.wm.keybindings');
    keys.setSwitchInputSource(['XF86Keyboard']);
    assertEqual(wm.get_strv('switch-input-source'), ['XF86Keyboard']);
    for (const bad of [['<Super>space', 'a b'], ['<Evil>x'], 'XF86Keyboard', [42]])
        assertThrows(() => keys.setSwitchInputSource(bad), JSON.stringify(bad));
    assertEqual(wm.get_strv('switch-input-source'), ['XF86Keyboard'], 'unchanged');
    wm.reset('switch-input-source');
});

test('gnomeKeys: schemas this system lacks are skipped', () => {
    const keys = gnomeKeys(null);
    assertEqual([keys.bindings(), keys.inputSourceCount()], [[], 0]);
    assertThrows(() => keys.setSwitchInputSource(['XF86Keyboard']), 'no schema, no write');
});

test('toVariant: the value must already be of the key\'s type', () => {
    const cases = [
        ['b', true, true], ['b', 'yes', false], ['s', '', true], ['s', 1, false],
        ['u', 25, true], ['u', -1, false], ['u', 1.5, false],
        ['as', ['a'], true], ['as', 'a', false], ['as', [1], false],
        ['(asas)', [[], []], true], ['(asas)', [[]], false], ['(suu)', ['d', 1, 2], true],
        ['aa{sv}', [{id: new GLib.Variant('s', 'x')}], true], ['aa{sv}', [{id: 'x', minutes: 5, on: true}], true],
        ['aa{sv}', [{minutes: 1.5}], false], ['aa{sv}', [{minutes: -1}], false], ['aa{sv}', [{x: null}], false],
        ['a{ss}', {A: 'b'}, true], ['a{ss}', {A: 1}, false],
    ];
    for (const [type, value, fits] of cases)
        assertEqual(toVariant(type, value) !== null, fits, `${type} ${JSON.stringify(value)}`);
});

test('gnomeKeys: custom shortcut paths that aren\'t dconf folders are skipped (Scan S0-5)', () => {
    const media = open('org.gnome.settings-daemon.plugins.media-keys');
    const good = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom_2/';
    new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding', path: good}).set_string('binding', '<Super>j');
    media.set_strv('custom-keybindings', ['', 'relative/', '/no-slash', '/a//b/', good]);
    const keys = gnomeKeys();
    const customs = keys.bindings().filter(b => b.schema.endsWith('custom-keybinding'));
    assertEqual(customs.map(b => b.key), [good]);
    const handle = keys.watch(() => {});
    handle.dispose();
    media.reset('custom-keybindings');
});

test('keyValues: an aa{sv} list round-trips as plain objects', () => {
    const settings = keyValues(open('org.gnome.shell.extensions.headsup'));
    const options = [{id: 'custom-1', label: 'Walk', icon: 'dot', minutes: 20}];
    settings.set('break-options', options);
    assertEqual(settings.get('break-options'), options);
    settings.reset('break-options');
});
