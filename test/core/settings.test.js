import {test, assertEqual, assertThrows, schemaPort} from '../harness.js';
import {SettingsStore} from '../../lib/core/settings.js';

const store = () => {
    const ports = {settings: schemaPort('org.gnome.shell.extensions.headsup'), state: schemaPort('org.gnome.shell.extensions.headsup.state')};
    return {ports, store: new SettingsStore(ports)};
};

test('state holds every key of both schemas, frozen', () => {
    const {store: s} = store();
    assertEqual(s.state['hud-shortcut'], ['<Super>space']);
    assertEqual(s.state['input-source-claim'], 'none');
    assertEqual(Object.isFrozen(s.state) && Object.isFrozen(s.state['hud-shortcut']), true);
});

test('set writes the right schema and fires changed with the key', () => {
    const {ports, store: s} = store();
    const seen = [];
    s.on('changed', key => seen.push(key));
    s.set('appearance', 'dark');
    s.set('welcome-done', true);
    assertEqual(ports.settings.get('appearance'), 'dark');
    assertEqual(ports.state.get('welcome-done'), true);
    assertEqual(seen, ['appearance', 'welcome-done']);
    assertEqual(s.state.appearance, 'dark');
});

test('a change from elsewhere (the other process) updates state', () => {
    const {ports, store: s} = store();
    ports.settings.set('close-on-click-outside', false);
    assertEqual(s.state['close-on-click-outside'], false);
});

test('unknown keys and wrong types throw', () => {
    const {store: s} = store();
    assertThrows(() => s.set('nope', 1), 'unknown key');
    assertThrows(() => s.set('welcome-done', 'yes'), 'wrong type');
});

test('reset clears the settings only, never the state', () => {
    const {ports, store: s} = store();
    s.set('appearance', 'light');
    s.set('input-source-claim', 'taken');
    s.reset();
    assertEqual(s.state.appearance, 'system');
    assertEqual(ports.state.get('input-source-claim'), 'taken');
});

test('dispose stops watching', () => {
    const {ports, store: s} = store();
    s.dispose();
    assertEqual(ports.settings.live + ports.state.live, 0);
});

test('two schemas sharing a key name throw', () => {
    const settings = schemaPort('org.gnome.shell.extensions.headsup');
    const state = {...schemaPort('org.gnome.shell.extensions.headsup.state'), keys: () => ['appearance']};
    assertThrows(() => new SettingsStore({settings, state}), 'shared key');
});
