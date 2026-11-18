import Gio from 'gi://Gio';

import {test, assertEqual} from '../harness.js';
import {DEFAULT_BREAK_OPTIONS, FocusSettingsEditor, readFocusSettings, validOptionId} from '../../lib/core/focusSettings.js';
import {keyValues} from '../../lib/adapters/gsettings.js';
import {schemaPort, testPorts} from '../harness.js';
import {SettingsStore} from '../../lib/core/settings.js';

const UUID = '0b6c3a52-6f43-4bb5-9f11-2f0f3d7c9a10';

test('the defaults in code are the schema\'s', () => {
    const settings = keyValues(new Gio.Settings({schema_id: 'org.gnome.shell.extensions.headsup'}));
    settings.reset('break-options');
    assertEqual(settings.get('break-options'), DEFAULT_BREAK_OPTIONS);
    const read = readFocusSettings(Object.fromEntries(settings.keys().map(k => [k, settings.get(k)])));
    assertEqual([read.focusLength, read.snoozeMinutes, read.openHudOnEnd, read.autoStartNextFocus], [25, 5, true, false]);
});

test('values outside their sets read as the defaults (the Mac\'s broken-section rules)', () => {
    const read = readFocusSettings({'focus-length': 33, 'snooze-minutes': 7, 'break-options': []});
    assertEqual([read.focusLength, read.snoozeMinutes, read.breakOptions], [25, 5, DEFAULT_BREAK_OPTIONS]);
});

test('break options: bad ids, empty labels and repeats are dropped; icon and length fall back', () => {
    const read = readFocusSettings({'break-options': [
        {id: 'water', label: 'Water', icon: 'droplet', minutes: 5},
        {id: 'water', label: 'Again', icon: 'droplet', minutes: 5},
        {id: '../x', label: 'Bad id', icon: 'dot', minutes: 5},
        {id: `custom-${UUID}`, label: '   ', icon: 'dot', minutes: 5},
        {id: `custom-${UUID}`, label: ' Walk ', icon: 'rocket', minutes: 7},
        'not an object',
    ]});
    assertEqual(read.breakOptions, [
        {id: 'water', label: 'Water', icon: 'droplet', minutes: 5},
        {id: `custom-${UUID}`, label: 'Walk', icon: 'dot', minutes: 5},
    ]);
});

test('option ids: the defaults\' or custom-<uuid>', () => {
    assertEqual(['look', `custom-${UUID}`, 'custom-1', 'Look', '', 3].map(validOptionId), [true, true, false, false, false, false]);
});

test('DEFAULT_BREAK_OPTIONS equals the compiled schema\'s default (Nick)', () => {
    const ports = testPorts();
    assertEqual(ports.settings.get('break-options'), DEFAULT_BREAK_OPTIONS);
});

test('the editor alone (as prefs build it): every writer, by the rules', () => {
    const store = new SettingsStore({settings: schemaPort('org.gnome.shell.extensions.headsup'), state: schemaPort('org.gnome.shell.extensions.headsup.state')});
    const editor = new FocusSettingsEditor(store);
    editor.setFocusLength(40);
    editor.setFocusLength(33);
    editor.setSnoozeMinutes(10);
    editor.setOpenHudOnEnd(false);
    editor.setAutoStartNextFocus(true);
    editor.setBreakOptionLength('look', 20);
    editor.setBreakOptionLength('look', 7);
    editor.addBreakOption('Walk', 50);
    editor.removeBreakOption('water');
    const s = editor.settings;
    assertEqual([s.focusLength, s.snoozeMinutes, s.openHudOnEnd, s.autoStartNextFocus], [40, 10, false, true]);
    assertEqual(s.breakOptions.map(o => [o.label, o.minutes]),
        [['Look elsewhere', 20], ['Stretch your arms', 5], ['Ping a friend', 10], ['Have lunch', 50], ['Walk', 50]]);
    store.dispose();
});
