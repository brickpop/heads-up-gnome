// ADR-002 §6.3: one test per row of the table, then Scan N3, G8a and G8b.

import {test, assertEqual, testPorts} from '../harness.js';
import {recorderProblem, shortcutClaim, shortcutRelease} from '../../lib/core/shortcutClaim.js';
import {createApp} from '../../lib/core/app.js';

const SUPER_SPACE = ['<Super>space'];
const SWITCH_DEFAULT = ['<Super>space', 'XF86Keyboard'];
const SWITCH_TAKEN = ['XF86Keyboard'];

const bindings = (switchAccels = SWITCH_DEFAULT, others = []) => [
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-input-source', name: 'Switch to next input source', accels: switchAccels},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-input-source-backward', name: 'Switch to previous input source', accels: ['<Shift><Super>space']},
    ...others,
];

const claim = input => shortcutClaim({
    wanted: SUPER_SPACE, bindings: bindings(), sourceCount: 1, consent: false,
    claim: 'none', record: {before: [], written: []}, ...input,
});

const TAKEN = {claim: 'taken', record: {before: SWITCH_DEFAULT, written: SWITCH_TAKEN}, bindings: bindings(SWITCH_TAKEN)};

const pick = (r, ...keys) => Object.fromEntries(keys.map(k => [k, r[k]]));

test('no clash: register, ok', () => {
    const r = claim({wanted: ['<Super>h'], bindings: bindings()});
    assertEqual(pick(r, 'status', 'register', 'claim', 'switchInputSource'), {status: 'ok', register: true, claim: 'none', switchInputSource: undefined});
});

test('clash with another GNOME action: nothing, in-use with its name', () => {
    const r = claim({bindings: bindings(SWITCH_DEFAULT, [{schema: 'org.gnome.shell.keybindings', key: 'toggle-overview', name: 'Show the overview', accels: ['<Super>space']}])});
    assertEqual(pick(r, 'status', 'holder', 'register', 'switchInputSource'), {status: 'in-use', holder: 'Show the overview', register: false, switchInputSource: undefined});
});

test('clash with switch-input-source, one source: take, keeping XF86Keyboard', () => {
    const r = claim({});
    assertEqual(pick(r, 'status', 'register', 'claim', 'record', 'switchInputSource'), {
        status: 'ok', register: true, claim: 'taken',
        record: {before: SWITCH_DEFAULT, written: SWITCH_TAKEN}, switchInputSource: SWITCH_TAKEN,
    });
});

test('clash with switch-input-source, two sources and consent: take', () => {
    const r = claim({sourceCount: 2, consent: true});
    assertEqual(pick(r, 'status', 'claim', 'switchInputSource'), {status: 'ok', claim: 'taken', switchInputSource: SWITCH_TAKEN});
});

test('clash with switch-input-source, two sources, no consent: nothing, layouts', () => {
    const r = claim({sourceCount: 2});
    assertEqual(pick(r, 'status', 'register', 'claim', 'switchInputSource'), {status: 'layouts', register: false, claim: 'none', switchInputSource: undefined});
});

test('taken, a second source appears, no consent: give back, layouts, notice', () => {
    const r = claim({...TAKEN, sourceCount: 2});
    assertEqual(pick(r, 'status', 'register', 'claim', 'record', 'switchInputSource', 'layoutNotice', 'consent'), {
        status: 'layouts', register: false, claim: 'none', record: {before: [], written: []},
        switchInputSource: SWITCH_DEFAULT, layoutNotice: true, consent: undefined,
    });
});

test('taken, the user put the keys back: returned, consent off, nothing registered', () => {
    const r = claim({...TAKEN, consent: true, bindings: bindings(['<Super>space'])});
    assertEqual(pick(r, 'status', 'register', 'claim', 'record', 'consent', 'switchInputSource'), {
        status: 'layouts', register: false, claim: 'returned', record: {before: [], written: []},
        consent: false, switchInputSource: undefined,
    });
});

test('taken, the user changed layout switching without the keys: their value stays, ok', () => {
    const r = claim({...TAKEN, bindings: bindings(['<Alt>Shift_L'])});
    assertEqual(pick(r, 'status', 'register', 'claim', 'record', 'consent', 'switchInputSource'), {
        status: 'ok', register: true, claim: 'none', record: {before: [], written: []},
        consent: undefined, switchInputSource: undefined,
    });
});

test('returned, no consent: nothing, even with one source', () => {
    const r = claim({claim: 'returned', sourceCount: 1});
    assertEqual(pick(r, 'status', 'register', 'claim', 'switchInputSource'), {status: 'layouts', register: false, claim: 'returned', switchInputSource: undefined});
});

test('returned, consent turned on: take', () => {
    const r = claim({claim: 'returned', consent: true});
    assertEqual(pick(r, 'status', 'register', 'claim', 'switchInputSource'), {status: 'ok', register: true, claim: 'taken', switchInputSource: SWITCH_TAKEN});
});

test('taken, hud-shortcut changes to other keys: give back, then the table for the new keys', () => {
    const r = claim({...TAKEN, wanted: ['<Super>h']});
    assertEqual(pick(r, 'status', 'register', 'claim', 'record', 'switchInputSource', 'consent'), {
        status: 'ok', register: true, claim: 'none', record: {before: [], written: []},
        switchInputSource: SWITCH_DEFAULT, consent: undefined,
    });
});

test('taken, hud-shortcut changes to keys another action holds: give back, in-use', () => {
    const r = claim({...TAKEN, wanted: ['<Super>v'], bindings: bindings(SWITCH_TAKEN, [{schema: 'org.gnome.shell.keybindings', key: 'toggle-message-tray', name: 'Show the notification list', accels: ['<Super>v']}])});
    assertEqual(pick(r, 'status', 'claim', 'switchInputSource'), {status: 'in-use', claim: 'none', switchInputSource: SWITCH_DEFAULT});
});

test('Mutter refuses the keys: failed (ShortcutController)', () => {
    const ports = testPorts({settings: {'hud-shortcut': ['<Super>h']}});
    ports.hotkey.refuse = true;
    const app = createApp(ports);
    assertEqual(ports.state.get('hud-shortcut-status'), 'failed');
    app.dispose();
});

test('taken, nothing changed: keep, ok, no write', () => {
    const r = claim(TAKEN);
    assertEqual(pick(r, 'status', 'register', 'claim', 'switchInputSource'), {status: 'ok', register: true, claim: 'taken', switchInputSource: undefined});
});

test('keys match whatever their spelling', () => {
    const r = claim({wanted: ['<Super>Space'], bindings: bindings(['<Primary><Super>x', '<Super>space'])});
    assertEqual(pick(r, 'status', 'switchInputSource'), {status: 'ok', switchInputSource: ['<Primary><Super>x']});
});

test('an empty or invalid wake shortcut: failed, nothing written', () => {
    for (const wanted of [[], ['<Super>space;rm']]) {
        const r = claim({wanted});
        assertEqual(pick(r, 'status', 'register', 'switchInputSource'), {status: 'failed', register: false, switchInputSource: undefined}, JSON.stringify(wanted));
    }
});

// G8b: only valid accelerators are ever written, and a damaged record writes nothing.

test('a damaged record writes nothing and is dropped', () => {
    const damaged = [
        {before: ['<Super>space', 'evil\nkey'], written: SWITCH_TAKEN},
        {before: [], written: SWITCH_TAKEN},
        {before: SWITCH_DEFAULT, written: ['<Super']},
        {before: 'x', written: []},
    ];
    for (const record of damaged) {
        const r = claim({claim: 'taken', record, bindings: bindings(SWITCH_TAKEN)});
        assertEqual(pick(r, 'claim', 'record', 'switchInputSource', 'problem', 'status'), {
            claim: 'none', record: {before: [], written: []}, switchInputSource: undefined,
            problem: 'shortcut.record-damaged', status: 'ok',
        }, JSON.stringify(record));
        const release = shortcutRelease({claim: 'taken', record, bindings: bindings(SWITCH_TAKEN)});
        assertEqual(release.switchInputSource, undefined, 'release');
    }
});

test('an unreadable switch-input-source value is never rewritten', () => {
    const r = claim({bindings: bindings(['<Super>space', 'bad key'])});
    assertEqual(pick(r, 'status', 'claim', 'switchInputSource', 'problem'), {status: 'layouts', claim: 'none', switchInputSource: undefined, problem: 'shortcut.switch-unreadable'});
});

// G8a: give back only what HeadsUp wrote.

test('release gives back while switch-input-source holds what HeadsUp wrote', () => {
    const r = shortcutRelease(TAKEN);
    assertEqual(pick(r, 'status', 'claim', 'switchInputSource'), {status: 'off', claim: 'none', switchInputSource: SWITCH_DEFAULT});
});

test('a user edit in between writes nothing, at release and in the table', () => {
    const edited = {...TAKEN, bindings: bindings(['<Alt>Shift_L'])};
    assertEqual(shortcutRelease(edited).switchInputSource, undefined, 'release');
    assertEqual(claim({...edited, sourceCount: 2}).switchInputSource, undefined, 'second layout');
    assertEqual(claim({...edited, wanted: ['<Super>h']}).switchInputSource, undefined, 'new keys');
});

// Scan N3: HeadsUp's own give-back never looks like the user's.

const consentKept = (ports, expected) =>
    assertEqual(ports.settings.get('take-input-source-key'), expected, 'take-input-source-key');

/** Records the order of writes to the state and to switch-input-source. */
const recordOrder = ports => {
    const order = [];
    const set = ports.state.set.bind(ports.state);
    ports.state.set = (key, value) => (order.push(key), set(key, value));
    const write = ports.gnomeKeys.setSwitchInputSource.bind(ports.gnomeKeys);
    ports.gnomeKeys.setSwitchInputSource = accels => (order.push('switch-input-source'), write(accels));
    return order;
};

const claimFirst = order =>
    assertEqual(order.indexOf('input-source-claim') < order.indexOf('switch-input-source'), true, `order ${order}`);

test('N3: give back on disable keeps the consent, the claim written first', () => {
    const ports = testPorts({settings: {'take-input-source-key': true}, keys: undefined});
    ports.gnomeKeys.sources = 2;
    const order = recordOrder(ports);

    const app = createApp(ports);
    assertEqual(ports.state.get('input-source-claim'), 'taken');
    order.length = 0;
    app.dispose();
    claimFirst(order);
    assertEqual(ports.gnomeKeys.binding('switch-input-source').accels, SWITCH_DEFAULT);
    assertEqual(ports.state.get('hud-shortcut-status'), 'off');
    consentKept(ports, true);
});

test('N3: give back on a second layout keeps the consent unchanged and runs once', () => {
    const ports = testPorts();
    const app = createApp(ports);
    assertEqual(ports.gnomeKeys.writes, [SWITCH_TAKEN]);
    const order = recordOrder(ports);
    ports.gnomeKeys.userSetsSources(2);
    assertEqual(ports.gnomeKeys.writes, [SWITCH_TAKEN, SWITCH_DEFAULT]);
    assertEqual(ports.state.get('input-source-claim'), 'none');
    assertEqual(ports.state.get('hud-shortcut-status'), 'layouts');
    assertEqual(ports.state.get('layout-notice'), true);
    assertEqual(ports.hotkey.accels, null);
    consentKept(ports, false);
    claimFirst(order);
    app.dispose();
});

test('Give Super+Space back (consent off, two layouts): keys back, layouts, no notice', () => {
    const ports = testPorts({settings: {'take-input-source-key': true}});
    ports.gnomeKeys.sources = 2;
    const app = createApp(ports);
    assertEqual(ports.state.get('input-source-claim'), 'taken');
    const order = recordOrder(ports);
    app.settings.set('take-input-source-key', false);
    assertEqual(ports.gnomeKeys.binding('switch-input-source').accels, SWITCH_DEFAULT);
    assertEqual(ports.state.get('hud-shortcut-status'), 'layouts');
    assertEqual(ports.state.get('layout-notice'), false);
    claimFirst(order);
    app.dispose();
});

test('N3: give back on a new wake shortcut keeps the consent', () => {
    const ports = testPorts({settings: {'take-input-source-key': true}});
    const app = createApp(ports);
    const order = recordOrder(ports);
    app.settings.set('hud-shortcut', ['<Super>h']);
    claimFirst(order);
    assertEqual(ports.gnomeKeys.binding('switch-input-source').accels, SWITCH_DEFAULT);
    assertEqual(ports.state.get('input-source-claim'), 'none');
    assertEqual(ports.hotkey.accels, ['<Super>h']);
    consentKept(ports, true);
    app.dispose();
});

test('N3: running the table again after its own write is a no-op', () => {
    const ports = testPorts();
    const app = createApp(ports);
    const stateWrites = ports.state.writes.length;
    const keyWrites = ports.gnomeKeys.writes.length;
    app.shortcut.run();
    ports.gnomeKeys.userSets('switch-input-source-backward', ['<Shift><Super>space']);
    assertEqual(ports.state.writes.length, stateWrites, 'state writes');
    assertEqual(ports.gnomeKeys.writes.length, keyWrites, 'switch-input-source writes');
    app.dispose();
});

test('the user puts the keys back: consent off, status layouts, keys unregistered', () => {
    const ports = testPorts({settings: {'take-input-source-key': true}});
    const app = createApp(ports);
    assertEqual(ports.hotkey.accels, SUPER_SPACE);
    ports.gnomeKeys.userSets('switch-input-source', SWITCH_DEFAULT);
    assertEqual(ports.state.get('input-source-claim'), 'returned');
    consentKept(ports, false);
    assertEqual(ports.state.get('hud-shortcut-status'), 'layouts');
    assertEqual(ports.hotkey.accels, null);
    assertEqual(ports.gnomeKeys.writes, [SWITCH_TAKEN], 'their value stays');
    app.dispose();
    assertEqual(ports.gnomeKeys.writes, [SWITCH_TAKEN], 'disable writes nothing');
});

test('after a crash (claim taken, no disable), enable registers by the same table', () => {
    const ports = testPorts({state: {'input-source-claim': 'taken', 'input-source-binding': [SWITCH_DEFAULT, SWITCH_TAKEN]}});
    ports.gnomeKeys.userSets('switch-input-source', SWITCH_TAKEN);
    const app = createApp(ports);
    assertEqual(ports.hotkey.accels, SUPER_SPACE);
    assertEqual(ports.state.get('hud-shortcut-status'), 'ok');
    assertEqual(ports.gnomeKeys.writes, []);
    app.dispose();
});

test('a change that arrives while the controller writes still takes effect', () => {
    const ports = testPorts();
    const write = ports.gnomeKeys.setSwitchInputSource.bind(ports.gnomeKeys);
    let once = true;
    ports.gnomeKeys.setSwitchInputSource = accels => {
        write(accels);
        if (once) {
            once = false;
            ports.gnomeKeys.userSetsSources(2);
        }
    };
    const app = createApp(ports);
    assertEqual(ports.gnomeKeys.binding('switch-input-source').accels, SWITCH_DEFAULT, 'given back');
    assertEqual(ports.state.get('input-source-claim'), 'none');
    assertEqual(ports.state.get('hud-shortcut-status'), 'layouts');
    assertEqual(ports.hotkey.accels, null);
    app.dispose();
});

test('lock then unlock: one unregister, exactly one register, no status write', () => {
    const ports = testPorts();
    const app = createApp(ports);
    const registrations = ports.hotkey.registrations;
    ports.state.writes = [];
    ports.session.lock();
    assertEqual(ports.hotkey.accels, null, 'unregistered');
    ports.session.unlock();
    assertEqual(ports.hotkey.registrations - registrations, 1);
    assertEqual(ports.hotkey.accels, SUPER_SPACE);
    assertEqual(ports.state.writes.filter(([key]) => key === 'hud-shortcut-status' || key === 'hud-shortcut-holder'), []);
    app.dispose();
});

test('while locked, a change runs the table but writes no status until unlock', () => {
    const ports = testPorts();
    const app = createApp(ports);
    ports.session.lock();
    ports.state.writes = [];
    ports.gnomeKeys.userSetsSources(2);
    assertEqual(ports.state.writes.filter(([key]) => key === 'hud-shortcut-status' || key === 'hud-shortcut-holder'), [], 'no status while locked');
    assertEqual(ports.gnomeKeys.binding('switch-input-source').accels, SWITCH_DEFAULT, 'still given back');
    ports.session.unlock();
    assertEqual(ports.state.get('hud-shortcut-status'), 'layouts');
    app.dispose();
});

test('recorderProblem: the Save rules of the prefs recorder', () => {
    const list = bindings(SWITCH_DEFAULT, [{schema: 'org.gnome.desktop.wm.keybindings', key: 'close', name: 'Close window', accels: ['<Alt>F4']}]);
    const cases = [
        ['<Super>space', null],
        ['<Super>h', null],
        ['F9', null],
        ['h', {kind: 'needs-modifier'}],
        ['<Shift>h', {kind: 'needs-modifier'}],
        ['<Control>2', {kind: 'used-by-headsup'}],
        ['<Primary>comma', {kind: 'used-by-headsup'}],
        ['<Control>Return', {kind: 'used-by-headsup'}],
        ['<Control>Page_Down', {kind: 'used-by-headsup'}],
        ['<Control><Shift>n', null],
        ['<Alt>F4', {kind: 'in-use', holder: 'Close window'}],
        ['<Shift><Super>Space', {kind: 'in-use', holder: 'Switch to previous input source'}],
        ['<Super>bad key', {kind: 'invalid'}],
    ];
    for (const [accel, problem] of cases)
        assertEqual(recorderProblem(accel, list), problem, accel);
});

test('returned, and the wanted keys no longer clash: claim none (Rev 33)', () => {
    const r = claim({claim: 'returned', wanted: ['<Super>h']});
    assertEqual(pick(r, 'status', 'register', 'claim', 'switchInputSource'), {status: 'ok', register: true, claim: 'none', switchInputSource: undefined});
});

test('while locked, a failed registration keeps its status: lock writes nothing', () => {
    const ports = testPorts({settings: {'hud-shortcut': ['<Super>h']}});
    ports.hotkey.refuse = true;
    const app = createApp(ports);
    assertEqual(ports.state.get('hud-shortcut-status'), 'failed');
    ports.state.writes = [];
    ports.gnomeKeys.writes = [];
    ports.session.lock();
    ports.gnomeKeys.userSetsSources(2);
    assertEqual(ports.state.get('hud-shortcut-status'), 'failed');
    assertEqual(ports.state.writes.filter(([key]) => key === 'hud-shortcut-status' || key === 'hud-shortcut-holder'), []);
    app.dispose();
});

test('lock only unregisters: no table run, no write of any kind', () => {
    const ports = testPorts();
    const app = createApp(ports);
    ports.state.writes = [];
    ports.gnomeKeys.writes = [];
    let reads = 0;
    const bindings = ports.gnomeKeys.bindings.bind(ports.gnomeKeys);
    ports.gnomeKeys.bindings = () => (reads++, bindings());
    ports.session.lock();
    assertEqual([reads, ports.state.writes, ports.gnomeKeys.writes, ports.hotkey.accels], [0, [['hud-shortcut-active', []]], [], null]);
    app.dispose();
});

test('a run that never settles stops after a few rounds and logs shortcut.loop', () => {
    const ports = testPorts();
    const app = createApp(ports);
    // Another program answers each of our claim writes by adding or removing a layout.
    const set = ports.state.set.bind(ports.state);
    ports.state.set = (key, value) => {
        set(key, value);
        if (key === 'input-source-claim')
            ports.gnomeKeys.userSetsSources(ports.gnomeKeys.sources === 1 ? 2 : 1);
    };
    ports.gnomeKeys.userSetsSources(2);
    assertEqual(ports.log.entries.some(([code]) => code === 'shortcut.loop'), true, JSON.stringify(ports.log.entries));
    app.dispose();
});

test('returned, and the new keys held by another GNOME action: claim cleared, in-use (Rev 14)', () => {
    const r = claim({claim: 'returned', wanted: ['<Super>v'], bindings: bindings(SWITCH_DEFAULT, [{schema: 'org.gnome.shell.keybindings', key: 'toggle-message-tray', name: 'Show the notification list', accels: ['<Super>v']}])});
    assertEqual(pick(r, 'status', 'claim', 'switchInputSource'), {status: 'in-use', claim: 'none', switchInputSource: undefined});
});

// hud-shortcut-active: the keys in force, written only around a registration (Scan P0-1).

test('hud-shortcut-active holds the registered keys, and [] once unregistered', () => {
    const ports = testPorts();
    const app = createApp(ports);
    assertEqual(ports.state.get('hud-shortcut-active'), SUPER_SPACE);
    ports.session.lock();
    assertEqual(ports.state.get('hud-shortcut-active'), []);
    ports.session.unlock();
    assertEqual(ports.state.get('hud-shortcut-active'), SUPER_SPACE);
    app.dispose();
    assertEqual(ports.state.get('hud-shortcut-active'), []);
});

test('a hud-shortcut change the table refuses never reaches hud-shortcut-active', () => {
    const ports = testPorts({keys: {bindings: [
        {schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-input-source', name: 'Switch to next input source', accels: ['<Super>space', 'XF86Keyboard']},
        {schema: 'org.gnome.desktop.wm.keybindings', key: 'close', name: 'Close window', accels: ['<Alt>F4']},
    ]}});
    const app = createApp(ports);
    ports.state.writes = [];
    app.settings.set('hud-shortcut', ['<Alt>F4']);
    assertEqual(ports.state.get('hud-shortcut-status'), 'in-use');
    assertEqual(ports.state.writes.filter(([key, value]) => key === 'hud-shortcut-active' && value.length), []);
    app.settings.set('hud-shortcut', ['bad key']);
    assertEqual(ports.state.writes.filter(([key, value]) => key === 'hud-shortcut-active' && value.length), []);
    app.dispose();
});

test('new keys: unregister, then write hud-shortcut-active, then register; a refusal ends failed', () => {
    const ports = testPorts();
    const app = createApp(ports);
    const order = [];
    const set = ports.state.set.bind(ports.state);
    ports.state.set = (key, value) => (key === 'hud-shortcut-active' && order.push(`active ${JSON.stringify(value)}`), set(key, value));
    const register = ports.hotkey.register.bind(ports.hotkey);
    ports.hotkey.register = (accels, fn) => (order.push('register'), register(accels, fn));
    const unregister = ports.hotkey.unregister.bind(ports.hotkey);
    ports.hotkey.unregister = () => (order.push('unregister'), unregister());
    ports.hotkey.refuse = true;
    app.settings.set('hud-shortcut', ['<Super>h']);
    assertEqual(order.slice(0, 4), ['unregister', 'active []', 'active ["<Super>h"]', 'register']);
    assertEqual([ports.state.get('hud-shortcut-status'), ports.state.get('hud-shortcut-active')], ['failed', []]);
    app.dispose();
});
