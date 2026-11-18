// KeepAwake: the Mac's PowerHoldsTests (the Caffeine and holder parts; services come in
// slice 3), plus the asynchronous answers of GNOME's session manager (Nick, slice 2).

import {test, assertEqual, settle, testPorts} from '../harness.js';
import {KeepAwake} from '../../lib/core/keepAwake.js';
import {SettingsStore} from '../../lib/core/settings.js';

function setup(settings = {}) {
    const ports = testPorts({settings});
    const store = new SettingsStore(ports);
    const keepAwake = new KeepAwake({...ports, store});
    const reasons = () => ports.inhibitor.held.map(h => `${h.flags} ${h.reason}`).sort();
    return {ports, store, keepAwake, reasons, done: () => (keepAwake.dispose(), store.dispose())};
}

test('every holder\'s holds are held, one inhibitor each, and each releases only its own', async () => {
    const {keepAwake, reasons, done} = setup();
    keepAwake.set('caffeine', ['display', 'system'], 'Caffeine');
    keepAwake.set('service:1', ['system'], 'Web dev server');
    await settle();
    assertEqual(reasons(), ['4 HeadsUp: Caffeine', '4 HeadsUp: Web dev server', '8 HeadsUp: Caffeine']);
    assertEqual(keepAwake.status('caffeine'), {held: ['display', 'system'], pending: [], refused: []});
    keepAwake.set('caffeine', [], 'Caffeine');
    assertEqual(reasons(), ['4 HeadsUp: Web dev server']);
    done();
});

test('a hold is pending until GNOME answers', async () => {
    const {ports, keepAwake, done} = setup();
    ports.inhibitor.answerLater = true;
    keepAwake.set('caffeine', ['system'], 'Caffeine');
    assertEqual(keepAwake.status('caffeine'), {held: [], pending: ['system'], refused: []});
    ports.inhibitor.answerAll();
    await settle();
    assertEqual(keepAwake.status('caffeine').held, ['system']);
    done();
});

test('a refusal is mapped to its holder, and tried again only when that holder asks', async () => {
    const {ports, keepAwake, done} = setup();
    ports.inhibitor.refuse.add(8);
    keepAwake.set('caffeine', ['display', 'system'], 'Caffeine');
    await settle();
    assertEqual(keepAwake.status('caffeine'), {held: ['system'], pending: [], refused: ['display']});
    ports.inhibitor.refuse.clear();
    keepAwake.set('service:1', ['system'], 'Web dev server');
    await settle();
    assertEqual(keepAwake.status('caffeine').refused, ['display'], 'another holder asking doesn\'t retry it');
    keepAwake.set('caffeine', ['display', 'system'], 'Caffeine');
    await settle();
    assertEqual(keepAwake.status('caffeine'), {held: ['system', 'display'], pending: [], refused: []});
    done();
});

test('only on power adapter: on battery every hold is released; back on power, taken again', async () => {
    const {ports, keepAwake, done} = setup({'only-on-ac': true});
    keepAwake.set('caffeine', ['display', 'system'], 'Caffeine');
    keepAwake.set('service:1', ['system'], 'Web dev server');
    await settle();
    ports.power.set(true);
    assertEqual([keepAwake.pausedOnBattery, ports.inhibitor.held.length], [true, 0]);
    ports.power.set(false);
    await settle();
    assertEqual([keepAwake.pausedOnBattery, ports.inhibitor.held.length], [false, 3]);
    done();
});

test('on battery without the option, everything is held; turning it on pauses at once', async () => {
    const {ports, store, keepAwake, done} = setup();
    ports.power.set(true);
    keepAwake.set('caffeine', ['system'], 'Caffeine');
    await settle();
    assertEqual(ports.inhibitor.held.length, 1);
    store.set('only-on-ac', true);
    assertEqual(ports.inhibitor.held.length, 0);
    done();
});

test('an answer after the holder stopped wanting it is released at once (Nick 1a)', async () => {
    const {ports, keepAwake, done} = setup();
    ports.inhibitor.answerLater = true;
    keepAwake.set('caffeine', ['system'], 'Caffeine');
    keepAwake.set('caffeine', [], 'Caffeine');
    ports.inhibitor.answerAll();
    await settle();
    assertEqual([ports.inhibitor.held, keepAwake.status('caffeine')], [[], {held: [], pending: [], refused: []}]);
    done();
});

test('an answer after dispose is released at once, leaving nothing (Nick 1b)', async () => {
    const {ports, keepAwake, done} = setup();
    ports.inhibitor.answerLater = true;
    keepAwake.set('caffeine', ['display', 'system'], 'Caffeine');
    done();
    ports.inhibitor.answerAll();
    await settle();
    assertEqual([ports.inhibitor.live, ports.power.live], [0, 0]);
});

test('a D-Bus error counts as refused', async () => {
    const {ports, keepAwake, done} = setup();
    ports.inhibitor.hold = () => Promise.reject(new Error('no session manager'));
    keepAwake.set('caffeine', ['system'], 'Caffeine');
    await settle();
    assertEqual(keepAwake.status('caffeine').refused, ['system']);
    done();
});

test('the Idle fake: idle watches fire after their time without input, active watches at the next input', () => {
    const {ports, done} = setup();
    const seen = [];
    ports.idle.onIdle(60_000, () => seen.push('idle'));
    ports.clock.advance(59_000);
    ports.idle.input();
    ports.clock.advance(59_000);
    assertEqual([seen, ports.idle.idleMs()], [[], 59_000]);
    ports.clock.advance(1000);
    ports.idle.onActive(() => seen.push('active'));
    ports.idle.input();
    assertEqual([seen, ports.idle.live], [['idle', 'active'], 0]);
    done();
});
