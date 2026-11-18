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

// Auto-open with a tab, and toasts (the Mac's FocusReviewTests on autoOpen; Nick, slice 1).

test('auto-open: a closed HUD opens on its tab without the grab', () => {
    const {app, hud} = start();
    app.hud.autoOpen('focus', 'Break over');
    assertEqual([hud.visible, hud.focusedSince, app.hud.state.tab, app.hud.state.toast], [true, null, 'focus', null]);
    app.dispose();
});

test('auto-open: an open HUD in use stays as it is and toasts', () => {
    const {app} = start();
    app.hud.focus();
    app.hud.autoOpen('focus', 'Break over');
    assertEqual([app.hud.state.tab, app.hud.state.focused, app.hud.state.toast], ['chat', true, {text: 'Break over', seq: 1}]);
    app.dispose();
});

test('auto-open: an open HUD not in use switches to the tab; already on it, nothing changes', () => {
    const {app} = start({'welcome-done': true}, {'close-on-click-outside': false});
    app.hud.focus();
    app.hud.didResignKey();
    app.hud.autoOpen('focus', 'Break over');
    assertEqual([app.hud.state.tab, app.hud.state.focused, app.hud.state.toast], ['focus', false, null]);
    app.hud.autoOpen('focus', 'Break over');
    assertEqual(app.hud.state.toast, null);
    app.dispose();
});

test('auto-open while locked keeps its tab and plays after unlock', () => {
    const {ports, app, hud} = start();
    ports.session.lock();
    app.hud.autoOpen('focus', 'Break over');
    ports.session.unlock();
    assertEqual([hud.visible, app.hud.state.tab], [true, 'focus']);
    app.dispose();
});

test('focus(tab) opens on that tab with the grab', () => {
    const {app} = start();
    app.hud.focus('focus');
    assertEqual([app.hud.state.tab, app.hud.state.focused], ['focus', true]);
    app.dispose();
});

test('a toast clears after 2.6 s; a new one restarts the time; the same text twice changes seq', () => {
    const {ports, app} = start();
    app.hud.toast('Snoozed for 5 min');
    ports.clock.advance(2000);
    app.hud.toast('Snoozed for 5 min');
    assertEqual(app.hud.state.toast, {text: 'Snoozed for 5 min', seq: 2});
    ports.clock.advance(2000);
    assertEqual(app.hud.state.toast?.seq, 2, 'restarted');
    ports.clock.advance(600);
    assertEqual(app.hud.state.toast, null);
    app.dispose();
    assertEqual(ports.clock.live, 0);
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

// The prompt (Nick, slice 1).

test('typing gives suggestion rows, the first selected when it can be; no Ask row before the chat', () => {
    const {app} = start();
    app.hud.setInput('/fcous');
    assertEqual([app.hud.state.suggestions.map(r => r.kind), app.hud.state.selected], [['noMatch'], null]);
    app.hud.setInput('hello there');
    assertEqual(app.hud.state.suggestions, []);
    app.hud.setInput('focus');
    assertEqual([app.hud.state.suggestions.every(r => r.kind === 'action'), app.hud.state.selected], [true, 0]);
    app.hud.setInput('/start 35');
    assertEqual([app.hud.state.suggestions.length, app.hud.state.selected], [1, 0]);
    app.hud.setInput('');
    assertEqual([app.hud.state.suggestions, app.hud.state.selected], [[], null]);
    app.dispose();
});

test('arrows move among selectable rows, stopping at the ends', () => {
    const {app} = start();
    app.hud.setInput('focus');
    const last = app.hud.state.suggestions.length - 1;
    app.hud.moveSelection(-1);
    assertEqual(app.hud.state.selected, 0);
    for (let i = 0; i < 10; i++)
        app.hud.moveSelection(1);
    assertEqual(app.hud.state.selected, last);
    app.dispose();
});

test('Enter runs the selected action and clears the prompt; No matching actions runs nothing', () => {
    const {ports, app} = start();
    app.hud.focus('chat');
    app.hud.setInput('/start 30');
    app.hud.runSelected();
    assertEqual([app.focus.phase.run.minutes, app.hud.state.input, app.hud.state.tab], [30, '', 'focus']);
    ports.clock.advance(1500);
    assertEqual(app.hud.state.visible, false, 'its hide after start still runs');
    app.focus.stop();
    app.hud.focus();
    app.hud.setInput('/nothing');
    app.hud.runSelected();
    assertEqual([app.hud.state.input, app.focus.phase.kind], ['/nothing', 'idle']);
    app.dispose();
});

test('typing after a start keeps the HUD open', () => {
    const {ports, app} = start();
    app.hud.focus('focus');
    app.focus.start();
    app.hud.setInput('n');
    ports.clock.advance(2000);
    assertEqual(app.hud.state.visible, true);
    app.dispose();
});

test('while locked, the prompt doesn\'t change', () => {
    const {ports, app} = start();
    ports.session.lock();
    app.hud.setInput('/start 30');
    assertEqual(app.hud.state.input, '');
    ports.session.unlock();
    app.dispose();
});

test('tab activity: the Focus dot while a focus, a break or a prompt is under way', () => {
    const {app} = start();
    assertEqual(app.tabActivity(), {});
    app.focus.start();
    assertEqual(app.tabActivity(), {focus: 'active'});
    app.focus.takeBreakNow();
    assertEqual(app.tabActivity(), {focus: 'active'});
    app.focus.doneForNow();
    assertEqual(app.tabActivity(), {});
    app.dispose();
});

test('the pointer selects a row (not No matching actions) and a click runs it', () => {
    const {app} = start();
    app.hud.setInput('focus');
    app.hud.selectRow(2);
    assertEqual(app.hud.state.selected, 2);
    app.hud.selectRow(99);
    assertEqual(app.hud.state.selected, 2);
    app.hud.runRow(1);
    assertEqual([app.focus.phase.run.minutes, app.hud.state.input], [40, '']);
    app.hud.setInput('/fcous');
    app.hud.selectRow(0);
    assertEqual(app.hud.state.selected, null);
    app.dispose();
});

test('closing the HUD empties the prompt and its rows', () => {
    const {app} = start();
    app.hud.focus();
    app.hud.setInput('focus');
    app.hud.hide();
    assertEqual([app.hud.state.input, app.hud.state.suggestions, app.hud.state.selected], ['', [], null]);
    app.dispose();
});
