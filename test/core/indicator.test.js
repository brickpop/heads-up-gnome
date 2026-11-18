// The indicator and the menu: the Mac's StatusItemModelTests and MenuModelTests (Focus parts),
// and the click rules of MenuBarTests.

import {test, assertEqual, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {indicatorModel} from '../../lib/core/indicatorModel.js';
import {menuModel} from '../../lib/core/menuModel.js';

const now = 1_800_000_000_000;
const idle = {kind: 'timer', text: 'Idle', warning: false};
const OFF = {on: false, endsAt: null, pausedOnBattery: false, serviceHolds: []};
const on = (endsAt, pausedOnBattery = false) => ({on: true, endsAt, pausedOnBattery, serviceHolds: []});
const model = (focus, seconds = false, caffeine = OFF) => indicatorModel(focus, caffeine, now, seconds);
const IDLE_FOCUS = {kind: 'idle', nextLength: 25};
const running = (run, s) => ({kind: 'running', run, endsAt: now + s * 1000});

test('idle says Idle, and nothing changes by itself', () => {
    const m = model({kind: 'idle', nextLength: 25});
    assertEqual([m.parts, m.accessibleName, m.nextChange], [[idle], 'HeadsUp, idle', null]);
});

test('a running focus shows minutes rounded up; with seconds, m:ss', () => {
    const m = model(running('focus', 17 * 60 + 1));
    assertEqual([m.parts, m.accessibleName], [[{kind: 'timer', text: '18m', warning: false}], 'HeadsUp, focus, 18 minutes left']);
    assertEqual(model(running('rest', 3 * 60 + 10), true).parts, [{kind: 'timer', text: '3:10', warning: false}]);
});

test('paused is amber with the frozen time', () => {
    const m = model({kind: 'paused', run: 'focus', left: 18 * 60});
    assertEqual([m.parts, m.accessibleName, m.nextChange], [[{kind: 'timer', text: '18m', warning: true}], 'HeadsUp, focus paused, 18 minutes left', null]);
    assertEqual(model({kind: 'paused', run: 'rest', left: 90}).accessibleName, 'HeadsUp, break paused, 2 minutes left');
});

test('a waiting or snoozed prompt is amber: Break due or No focus', () => {
    assertEqual(model({kind: 'prompt', prompt: 'breakDue'}).parts, [{kind: 'timer', text: 'Break due', warning: true}]);
    assertEqual(model({kind: 'prompt', prompt: 'breakOver'}).accessibleName, 'HeadsUp, no focus');
    const snoozed = model({kind: 'snoozed', until: now + 300_000, prompt: 'breakOver'});
    assertEqual([snoozed.parts[0].text, snoozed.parts[0].warning, snoozed.nextChange], ['No focus', true, null]);
});

test('focus minutes change at the next minute boundary; seconds every second', () => {
    assertEqual(model(running('focus', 17 * 60 + 1)).nextChange, now + 1000);
    assertEqual(model(running('focus', 18 * 60)).nextChange, now + 60_000);
    assertEqual(model(running('focus', 100.25), true).nextChange, now + 250);
});

test('IndicatorModel redraws at each change, and arms nothing while idle', () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp(ports);
    const live = ports.clock.live;
    app.focus.start();
    assertEqual(app.indicator.state.parts[0].text, '25m');
    ports.clock.advance(60_001);
    assertEqual(app.indicator.state.parts[0].text, '24m');
    app.settings.set('menu-seconds', true);
    assertEqual(app.indicator.state.parts[0].text, '24:00');
    ports.clock.advance(1000);
    assertEqual(app.indicator.state.parts[0].text, '23:59');
    app.focus.stop();
    assertEqual([app.indicator.state.parts, ports.clock.live], [[idle], live]);
    app.dispose();
});

test('a click toggles the HUD; amber leads to Focus, and closes it there', () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp(ports);
    app.indicator.click();
    assertEqual([app.hud.state.visible, app.hud.state.tab], [true, 'chat']);
    app.indicator.click();
    assertEqual(app.hud.state.visible, false);
    app.focus.takeBreakNow();
    app.hud.focus('services');
    app.indicator.click();
    assertEqual([app.hud.state.visible, app.hud.state.tab], [true, 'focus']);
    app.indicator.click();
    assertEqual(app.hud.state.visible, false);
    app.indicator.click();
    assertEqual([app.hud.state.visible, app.hud.state.tab], [true, 'focus']);
    app.dispose();
});

test('a paused timer\'s click also leads to Focus', () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp(ports);
    app.focus.start();
    app.focus.pause();
    app.indicator.click();
    assertEqual(app.hud.state.tab, 'focus');
    app.dispose();
});

// The menu.

const focusRow = focus => menuModel({shortcut: 'Super+Space', focus, caffeine: OFF, now}).find(e => e.action === 'focus');

test('the menu\'s rows, in UX §3\'s order', () => {
    assertEqual(menuModel({shortcut: 'Super+Space', focus: {kind: 'idle', nextLength: 25}, caffeine: on(null), now}), [
        {kind: 'header', title: 'HeadsUp', shortcut: 'Super+Space'},
        {kind: 'row', action: 'openHud', title: 'Open HeadsUp'},
        {kind: 'separator'},
        {kind: 'row', action: 'focus', title: 'Focus', value: 'Start 25 min', warning: false},
        {kind: 'row', action: 'toggleCaffeine', title: 'Caffeine', switchOn: true},
        {kind: 'separator'},
        {kind: 'row', action: 'preferences', title: 'Preferences'},
    ]);
});

test('the header shows no shortcut while it doesn\'t work', () => {
    assertEqual(menuModel({shortcut: '', focus: {kind: 'idle', nextLength: 25}, caffeine: OFF, now})[0].shortcut, null);
});

test('the Focus row follows the design', () => {
    assertEqual(focusRow({kind: 'idle', nextLength: 50}).value, 'Start 50 min');
    assertEqual(focusRow(running('focus', 18 * 60 + 42)).value, 'Focus · 18:42');
    assertEqual(focusRow(running('rest', 190)).value, 'Break · 3:10');
    assertEqual([focusRow({kind: 'snoozed', until: now + 252_000, prompt: 'breakDue'}).value, focusRow({kind: 'snoozed', until: now, prompt: 'breakDue'}).warning], ['Snoozed · 4:12', true]);
    assertEqual([focusRow({kind: 'paused', run: 'focus', left: 18 * 60 + 42}).value, focusRow({kind: 'paused', run: 'focus', left: 1}).warning], ['Paused · 18:42', true]);
    assertEqual([focusRow({kind: 'prompt', prompt: 'breakDue'}).value, focusRow({kind: 'prompt', prompt: 'breakOver'}).warning], ['Break due', true]);
});

test('amber: a HUD shown on Focus without the keyboard is focused, not closed', () => {
    const ports = testPorts({state: {'welcome-done': true}, settings: {'close-on-click-outside': false}});
    const app = createApp(ports);
    app.focus.takeBreakNow();
    app.hud.focus('focus');
    app.hud.didResignKey();
    assertEqual([app.hud.state.visible, app.hud.state.focused], [true, false]);
    app.indicator.click();
    assertEqual([app.hud.state.visible, app.hud.state.focused, app.hud.state.tab], [true, true, 'focus']);
    app.dispose();
});

// Caffeine's cup (the Mac's StatusItemModelTests).

const cup = (text, accent) => ({kind: 'cup', text, accent});

test('caffeine shows the cup next to the timer, and only the cup until off', () => {
    assertEqual(model(running('focus', 600), false, on(now + 65 * 60_000)).parts, [{kind: 'timer', text: '10m', warning: false}, cup('1h 05m', true)]);
    assertEqual(model(IDLE_FOCUS, false, on(null)).parts, [idle, cup(null, true)]);
    assertEqual(model(IDLE_FOCUS, false, on(null)).nextChange, null, 'until off never changes by itself');
});

test('with seconds on, caffeine uses m:ss only under an hour', () => {
    assertEqual(model(IDLE_FOCUS, true, on(now + 59 * 60_000)).parts, [idle, cup('59:00', true)]);
    assertEqual(model(IDLE_FOCUS, true, on(now + 65 * 60_000)).parts, [idle, cup('1h 05m', true)]);
});

test('paused on battery: the cup without the accent, and says so', () => {
    const m = model(IDLE_FOCUS, false, on(now + 45 * 60_000, true));
    assertEqual([m.parts, m.accessibleName], [[idle, cup('45m', false)], 'HeadsUp, idle, caffeine paused on battery, 45 minutes left']);
});

test('caffeine minutes change just after each half minute; the earliest change wins', () => {
    assertEqual(model(IDLE_FOCUS, false, on(now + (17 * 60 + 40) * 1000)).nextChange, now + 10_000 + 1);
    assertEqual(model(IDLE_FOCUS, false, on(now + (17 * 60 + 30) * 1000)).nextChange, now + 1);
    assertEqual(model(running('focus', 17 * 60 + 20), false, on(now + (17 * 60 + 35) * 1000)).nextChange, now + 5000 + 1);
});

test('at each redraw the caffeine text is already the new minute', () => {
    const endsAt = now + 3 * 60_000;
    let time = now;
    const texts = [];
    for (let i = 0; i < 3; i++) {
        const m = indicatorModel(IDLE_FOCUS, on(endsAt), time, false);
        texts.push(m.parts.at(-1).text);
        time = m.nextChange;
    }
    assertEqual(texts, ['3m', '2m', '1m']);
});

test('services that keep the computer awake show the cup while Caffeine is off', () => {
    const held = {...OFF, serviceHolds: [{name: 'Web dev server', awake: 'holding'}]};
    const m = model(IDLE_FOCUS, false, held);
    assertEqual([m.parts, m.accessibleName], [[idle, cup(null, false)], 'HeadsUp, idle, kept awake by Web dev server']);
    const menu = menuModel({shortcut: '', focus: IDLE_FOCUS, caffeine: held, now});
    assertEqual(menu.find(e => e.kind === 'note'), {kind: 'note', text: 'Kept awake by Web dev server'});
});
