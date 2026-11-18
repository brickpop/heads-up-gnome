// HudStore (ADR-002 §4 items 3, 4 and 6; UX §7).

import {test, assertEqual, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';

/** An app past the welcome, HUD closed, unless `state` says otherwise. */
const start = (state = {'welcome-done': true}, settings = {}) => {
    const ports = testPorts({state, settings});
    return {ports, app: createApp(ports), hud: ports.hud};
};

test('the shortcut opens focused, then closes', () => {
    const {app, hud} = start();
    app.hud.hotkeyPressed();
    assertEqual([hud.visible, hud.focusedSince !== null, app.hud.state.focused], [true, true, true]);
    app.hud.hotkeyPressed();
    assertEqual([hud.visible, app.hud.state.visible], [false, false]);
    app.dispose();
});

test('the shortcut focuses an auto-opened HUD instead of closing it', () => {
    const {app, hud} = start();
    app.hud.autoOpen();
    assertEqual([hud.visible, hud.focusedSince, app.hud.state.focused], [true, null, false]);
    app.hud.hotkeyPressed();
    assertEqual([hud.visible, app.hud.state.focused], [true, true]);
    app.hud.hotkeyPressed();
    assertEqual(hud.visible, false);
    app.dispose();
});

test('the shortcut focuses a HUD left shown by a click elsewhere, then closes it', () => {
    const {app, hud} = start({'welcome-done': true}, {'close-on-click-outside': false});
    app.hud.focus();
    app.hud.didResignKey();
    assertEqual([hud.visible, hud.focusedSince, app.hud.state.focused], [true, null, false]);
    app.hud.hotkeyPressed();
    assertEqual([hud.visible, app.hud.state.focused], [true, true]);
    app.hud.hotkeyPressed();
    assertEqual(hud.visible, false);
    app.dispose();
});

test('a click elsewhere closes the HUD when close-on-click-outside is on', () => {
    const {app, hud} = start();
    app.hud.focus();
    app.hud.didResignKey();
    assertEqual(hud.visible, false);
    app.dispose();
});

test('toggle (indicator): focuses, then closes a focused HUD', () => {
    const {app, hud} = start();
    app.hud.toggle();
    assertEqual(app.hud.state.focused, true);
    app.hud.toggle();
    assertEqual(hud.visible, false);
    app.dispose();
});

test('tabs: select, wrap both ways, unknown tabs ignored', () => {
    const {app} = start();
    const seen = [];
    app.hud.on('changed', () => seen.push(app.hud.state.tab));
    app.hud.previousTab();
    assertEqual(app.hud.state.tab, 'commands');
    app.hud.nextTab();
    app.hud.nextTab();
    assertEqual(app.hud.state.tab, 'focus');
    app.hud.selectTab('services');
    app.hud.selectTab('settings');
    assertEqual(app.hud.state.tab, 'services');
    assertEqual(seen, ['commands', 'chat', 'focus', 'services']);
    app.dispose();
});

test('the welcome opens once on the first enable, on Chat, without the grab', () => {
    const {ports, app, hud} = start({});
    assertEqual([hud.visible, hud.focusedSince, app.hud.state.showsWelcome, app.hud.state.tab], [true, null, true, 'chat']);
    assertEqual(ports.state.get('welcome-done'), false, 'not ended by showing');
    app.dispose();
});

for (const [how, act] of [
    ['Esc (hide)', hud => hud.hide()],
    ['the shortcut', hud => hud.hotkeyPressed()],
    ['another tab', hud => hud.nextTab()],
    ['Set up a model', hud => hud.endWelcome()],
    ['a click elsewhere', hud => hud.didResignKey()],
]) {
    test(`the welcome ends with ${how}`, () => {
        const {ports, app} = start({});
        act(app.hud);
        assertEqual([ports.state.get('welcome-done'), app.hud.state.showsWelcome], [true, false]);
        app.dispose();
    });
}

test('the welcome waits for the unlock when enabled at the lock screen', () => {
    const ports = testPorts();
    ports.session.lock();
    const app = createApp(ports);
    assertEqual([ports.hud.visible, app.hud.state.autoOpenWaiting], [false, true]);
    ports.session.unlock();
    assertEqual([ports.hud.visible, app.hud.state.showsWelcome], [true, true]);
    app.dispose();
});

test('dismissLayoutNotice clears layout-notice', () => {
    const {ports, app} = start({'welcome-done': true, 'layout-notice': true});
    app.hud.dismissLayoutNotice();
    assertEqual(ports.state.get('layout-notice'), false);
    app.dispose();
});

test('locked: nothing changes; hide drops the waiting auto-open', () => {
    const {ports, app, hud} = start({'welcome-done': true, 'layout-notice': true});
    ports.session.lock();
    app.hud.autoOpen();
    app.hud.selectTab('focus');
    app.hud.nextTab();
    app.hud.endWelcome();
    app.hud.dismissLayoutNotice();
    app.hud.didResignKey();
    assertEqual([app.hud.state.tab, ports.state.get('layout-notice'), app.hud.state.autoOpenWaiting], ['chat', true, true]);
    app.hud.hide();
    assertEqual(app.hud.state.autoOpenWaiting, false);
    ports.session.unlock();
    assertEqual(hud.visible, false, 'the user acted: no auto-open');
    app.dispose();
});

test('a refused grab leaves the HUD shown, not focused; the next shortcut press focuses again', () => {
    const {ports, app, hud} = start();
    hud.refuseGrab = true;
    app.hud.hotkeyPressed();
    assertEqual([hud.visible, app.hud.state.visible, app.hud.state.focused], [true, true, false]);
    hud.refuseGrab = false;
    app.hud.hotkeyPressed();
    assertEqual([hud.visible, app.hud.state.focused], [true, true]);
    assertEqual(ports.hud.focusedSince !== null, true);
    app.dispose();
});
