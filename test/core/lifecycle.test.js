// ADR-002 §5: dispose leaves zero live handles; the locked screen never shows the HUD (G2).
// Slice 0: the settings, the wake shortcut and the HUD. Slice 1: Focus, its notification, the
// indicator and the catalogue. Slice 2: Caffeine and its inhibitors. Slice 3: Services, their
// scopes, logs and holds. Each slice adds its features here.

import {test, assertEqual, settle, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {liveHandles} from '../fakes.js';

test('dispose: every feature used, then zero live handles in every fake', () => {
    const ports = testPorts();
    const app = createApp(ports);
    ports.hotkey.press();
    app.hud.autoOpen();
    app.settings.set('appearance', 'dark');
    ports.gnomeKeys.userSetsSources(2);
    ports.gnomeKeys.userSetsSources(1);
    ports.session.lock();
    app.hud.autoOpen();
    ports.session.unlock();
    app.hud.toast('a toast');
    app.focus.start();
    app.settings.set('menu-seconds', true);
    app.actions.match('/start 30', {ask: null, inConversation: false})[0].action.run();
    ports.clock.advance(30 * 60_000);
    app.focus.snooze();
    ports.clock.advance(5 * 60_000);
    assertEqual(ports.notifier.shown.size, 1, 'a notification shows');
    assertEqual(ports.hotkey.accels, ['<Super>space'], 'registered before dispose');

    app.dispose();
    assertEqual(liveHandles(ports), {});
    assertEqual(ports.notifier.shown.size, 0, 'the notification is withdrawn');
    assertEqual(ports.state.get('hud-shortcut-status'), 'off');
    assertEqual(ports.gnomeKeys.binding('switch-input-source').accels, ['<Super>space', 'XF86Keyboard'], 'keys given back');
});

test('dispose while locked also leaves nothing', () => {
    const ports = testPorts();
    const app = createApp(ports);
    ports.session.lock();
    app.hud.autoOpen();
    app.dispose();
    assertEqual(liveHandles(ports), {});
});

test('locked: no path shows the HUD; one auto-open plays after unlock', () => {
    const ports = testPorts();
    const app = createApp(ports);
    ports.hotkey.press();
    assertEqual(ports.hud.visible, true, 'shown before the lock');

    ports.session.lock();
    assertEqual(ports.hud.visible, false, 'hidden on lock');
    assertEqual(ports.hotkey.accels, null, 'keybinding removed while locked');
    const opened = ports.hud.opened;
    ports.hotkey.press();
    app.hud.show();
    app.hud.focus();
    app.hud.toggle();
    app.hud.autoOpen();
    app.hud.autoOpen();
    assertEqual([ports.hud.visible, ports.hud.opened], [false, opened], 'nothing opened while locked');
    assertEqual(app.hud.state.autoOpenWaiting, true);

    ports.session.unlock();
    assertEqual([ports.hud.visible, ports.hud.focusedSince, ports.hud.opened], [true, null, opened + 1], 'shown once, without the grab');
    assertEqual(ports.hotkey.accels, ['<Super>space'], 'keybinding back');
    ports.session.lock();
    ports.session.unlock();
    assertEqual(ports.hud.opened, opened + 1, 'played once');
    app.dispose();
});

test('the wake shortcut focuses the HUD, and hides it when focused', () => {
    const ports = testPorts();
    const app = createApp(ports);
    ports.hotkey.press();
    assertEqual(ports.hud.focusedSince !== null, true);
    ports.hotkey.press();
    assertEqual(ports.hud.visible, false);
    app.dispose();
});

test('locked: a focus or break that ends doesn\'t show the HUD; it opens on Focus after unlock', () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp(ports);
    app.focus.start();
    ports.session.lock();
    ports.clock.advance(25 * 60_000);
    app.focus.startBreak();
    ports.notifier.answer('focus.timer', 'start-break');
    ports.notifier.answer('focus.timer', null);
    app.indicator.click();
    app.actions.actions.find(a => a.id === 'focus.break').run();
    assertEqual([ports.hud.visible, ports.hud.opened, app.focus.phase.kind], [false, 0, 'prompt']);
    ports.session.unlock();
    assertEqual([ports.hud.visible, ports.hud.focusedSince, app.hud.state.tab], [true, null, 'focus']);
    app.dispose();
});

test('dispose with Caffeine on (one answer still pending) leaves zero inhibitor cookies', async () => {
    const ports = testPorts({state: {'welcome-done': true}, settings: {'only-on-ac': true}});
    const app = createApp(ports);
    app.caffeine.selectDuration('1h');
    await settle();
    assertEqual(ports.inhibitor.held.length, 2);
    ports.power.set(true);
    ports.power.set(false);
    ports.inhibitor.answerLater = true;
    app.caffeine.setOption('keepDisplayOn', false);
    app.caffeine.setOption('keepDisplayOn', true);
    app.dispose();
    ports.inhibitor.answerAll();
    await settle();
    assertEqual(liveHandles(ports), {});
});

test('locked: Caffeine keeps the computer awake, and its end still comes', async () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp(ports);
    app.caffeine.selectDuration('15m');
    await settle();
    ports.session.lock();
    assertEqual([app.caffeine.isOn, ports.inhibitor.held.length, ports.hud.visible], [true, 2, false]);
    ports.clock.advance(15 * 60_000);
    assertEqual([app.caffeine.isOn, ports.inhibitor.held.length], [false, 0]);
    ports.session.unlock();
    app.dispose();
});

const SERVICE = {'id': '0b6c3a52-6f43-4bb5-9f11-2f0f3d7c9a10', 'name': 'Web', 'command': 'npm run dev', 'cwd': '~', 'env': {},
    'port': 3000, 'autostart': true, 'keep-awake-for': '30m', 'restart-on-exit': true};

test('dispose with a service running, holding and logging, and another waiting to restart: nothing left', async () => {
    const ports = testPorts({state: {'welcome-done': true}, settings: {services: [SERVICE, {...SERVICE, id: '1c7d4b63-7054-4cc6-8a22-3a1e4e8dab21', name: 'DB', port: 0}]}});
    const app = createApp(ports);
    await settle();
    ports.clock.advance(3000);
    ports.processes.last(SERVICE.id).write('ready\n');
    ports.processes.last('1c7d4b63-7054-4cc6-8a22-3a1e4e8dab21').exit({code: 1});
    await settle();
    app.services.toggleLogs(SERVICE.id);
    assertEqual([app.services.stateOf('1c7d4b63-7054-4cc6-8a22-3a1e4e8dab21').kind, ports.inhibitor.held.length > 0], ['waitingToRestart', true]);
    const stopsBefore = ports.processes.stoppedAll;
    app.dispose();
    await settle();
    assertEqual([ports.processes.stoppedAll, liveHandles(ports)], [stopsBefore + 1, {}]);
    ports.clock.advance(60_000);
    assertEqual(ports.processes.runs.length, 2, 'no restart after disable');
});

test('locked: services keep running and holding; Show Logs does nothing', async () => {
    const ports = testPorts({state: {'welcome-done': true}, settings: {services: [{...SERVICE, 'port': 0, 'restart-on-exit': false}]}});
    const app = createApp(ports);
    await settle();
    ports.clock.advance(3000);
    ports.session.lock();
    ports.processes.last(SERVICE.id).exit({code: 1});
    await settle();
    ports.notifier.answer(`service.failed:${SERVICE.id}`, 'show-logs');
    assertEqual([app.services.stateOf(SERVICE.id).kind, ports.hud.visible, app.services.openLogs], ['failed', false, null]);
    ports.session.unlock();
    app.dispose();
});

test('dispose leaves no wait for a readable pipe (no pollable source outlives disable, Nick)', async () => {
    const ports = testPorts({state: {'welcome-done': true}, settings: {services: [{...SERVICE, port: 0}]}});
    const app = createApp(ports);
    await settle();
    assertEqual(ports.processes.waits.size, 1, 'the running service waits for output');
    app.dispose();
    assertEqual(ports.processes.waits.size, 0);
});
