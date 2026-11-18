// CaffeineStore: the Mac's CaffeineStoreTests, CaffeineScreenTests, CaffeineFixLoopTests and
// CaffeineNoteTests, ported. GNOME answers asynchronously: `await settle()` lets it answer.

import {test, assertEqual, settle, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {readCaffeineSettings} from '../../lib/core/caffeine.js';
import * as format from '../../lib/core/format.js';

const DISPLAY = 8;
const SYSTEM = 4;

function harness({settings = {}, onBattery = false} = {}) {
    const ports = testPorts({settings, state: {'welcome-done': true}});
    ports.power.onBattery = onBattery;
    const app = createApp(ports);
    return {
        ports, app, caffeine: app.caffeine,
        held: () => ports.inhibitor.held.map(h => h.flags).sort(),
        toast: () => app.hud.state.toast?.text ?? null,
        minutes: m => ports.clock.advance(m * 60_000),
        now: () => ports.clock.now().getTime(),
        action: id => app.actions.actions.find(a => a.id === id),
        dispose: () => app.dispose(),
    };
}

// On and off.

test('the switch turns on with the last duration and holds both', async () => {
    const h = harness();
    h.caffeine.toggle();
    await settle();
    assertEqual([h.caffeine.isOn, h.caffeine.endsAt, h.held()], [true, h.now() + 3_600_000, [SYSTEM, DISPLAY]]);
    assertEqual([h.toast(), h.app.tabActivity().caffeine], ['Caffeine on. Your computer stays awake', 'active']);
    assertEqual(h.ports.inhibitor.held.map(i => i.reason), ['HeadsUp: Caffeine', 'HeadsUp: Caffeine']);
    h.caffeine.toggle();
    assertEqual([h.caffeine.isOn, h.held(), h.toast()], [false, [], 'Caffeine off']);
    h.dispose();
});

test('it turns off by itself when time is up, also after a suspend', async () => {
    const h = harness();
    h.caffeine.selectDuration('15m');
    await settle();
    h.minutes(14);
    assertEqual(h.caffeine.isOn, true);
    h.minutes(1);
    assertEqual([h.caffeine.isOn, h.held()], [false, []]);
    h.dispose();
});

test('until off has no end', async () => {
    const h = harness();
    h.caffeine.keepAwake('until-off');
    await settle();
    assertEqual([h.caffeine.endsAt, h.toast()], [null, 'Caffeine on · until turned off']);
    h.minutes(24 * 60);
    assertEqual([h.caffeine.isOn, h.caffeine.pill(h.now())], [true, 'Awake']);
    h.dispose();
});

test('a card starts with a toast while off and restarts silently while on', async () => {
    const h = harness();
    h.caffeine.selectDuration('2h');
    await settle();
    assertEqual([h.toast(), h.caffeine.lastDuration], ['Caffeine on · 2 hours', '2h']);
    h.minutes(30);
    h.app.hud.toast('something else');
    h.caffeine.selectDuration('15m');
    await settle();
    assertEqual([h.caffeine.endsAt, h.toast(), h.caffeine.lastDuration], [h.now() + 15 * 60_000, 'something else', '15m']);
    h.dispose();
});

test('a duration picked from the keyboard: off, it only becomes the last used; on, it restarts', async () => {
    const h = harness();
    h.caffeine.moveDurationSelection(1);
    assertEqual([h.caffeine.isOn, h.caffeine.lastDuration, h.caffeine.state.cardMoves], [false, '2h', 1]);
    h.caffeine.moveDurationSelection(5);
    h.caffeine.moveDurationSelection(1);
    assertEqual(h.caffeine.lastDuration, 'until-off', 'stops at the end');
    h.caffeine.toggle();
    h.caffeine.moveDurationSelection(-3);
    assertEqual([h.caffeine.isOn, h.caffeine.endsAt], [true, h.now() + 15 * 60_000]);
    h.dispose();
});

// Extend.

test('extend adds to the current end, or starts from now once it passed', async () => {
    const h = harness();
    h.caffeine.selectDuration('1h');
    h.minutes(20);
    h.caffeine.extend(10);
    assertEqual([h.caffeine.endsAt, h.toast()], [h.now() + 50 * 60_000, 'Caffeine extended by 10 min']);
    h.caffeine.extend(60);
    assertEqual(h.toast(), 'Caffeine extended by 1 hour');
    h.dispose();
    const late = harness();
    late.caffeine.selectDuration('15m');
    late.ports.clock.jump(20 * 60_000);
    late.caffeine.extend(10);
    assertEqual(late.caffeine.endsAt, late.now() + 10 * 60_000);
    late.minutes(9);
    assertEqual(late.caffeine.isOn, true);
    late.minutes(1);
    assertEqual(late.caffeine.isOn, false);
    late.dispose();
});

test('until off can\'t be extended', () => {
    const h = harness();
    h.caffeine.keepAwake('until-off');
    h.caffeine.extend(10);
    assertEqual(h.caffeine.endsAt, null);
    h.dispose();
});

// Options.

test('the two options can\'t both be off; both off in dconf read as both on', () => {
    const h = harness();
    h.caffeine.setOption('keepDisplayOn', false);
    h.caffeine.setOption('preventSystemSleep', false);
    assertEqual([h.caffeine.options.keepDisplayOn, h.caffeine.options.preventSystemSleep], [false, true]);
    h.dispose();
    const read = readCaffeineSettings({'keep-display-on': false, 'prevent-system-sleep': false, 'caffeine-duration': 'nope'});
    assertEqual([read.keepDisplayOn, read.preventSystemSleep, read.lastDuration], [true, true, '1h']);
});

test('options changed while on apply at once', async () => {
    const h = harness();
    h.caffeine.toggle();
    await settle();
    h.caffeine.setOption('keepDisplayOn', false);
    await settle();
    assertEqual(h.held(), [SYSTEM]);
    h.caffeine.setOption('keepDisplayOn', true);
    h.caffeine.setOption('preventSystemSleep', false);
    await settle();
    assertEqual(h.held(), [DISPLAY]);
    h.dispose();
});

// Battery.

test('only on power adapter pauses on battery and resumes on power, the countdown running', async () => {
    const h = harness({settings: {'only-on-ac': true}});
    h.caffeine.selectDuration('1h');
    await settle();
    assertEqual(h.held(), [SYSTEM, DISPLAY]);
    h.app.hud.toast('before');
    h.ports.power.set(true);
    assertEqual([h.caffeine.pausedOnBattery, h.held(), h.caffeine.isOn, h.toast()], [true, [], true, 'before']);
    assertEqual(h.app.indicator.state.parts.at(-1), {kind: 'cup', text: '1h 00m', accent: false});
    h.minutes(20);
    assertEqual(h.caffeine.pill(h.now()), 'Paused 40m');
    h.ports.power.set(false);
    await settle();
    assertEqual([h.caffeine.pausedOnBattery, h.held()], [false, [SYSTEM, DISPLAY]]);
    assertEqual(h.app.indicator.state.parts.at(-1), {kind: 'cup', text: '40m', accent: true});
    h.dispose();
});

test('on battery without the option Caffeine stays active; turning it on pauses at once', async () => {
    const h = harness({onBattery: true});
    h.caffeine.toggle();
    await settle();
    assertEqual([h.caffeine.pausedOnBattery, h.held()], [false, [SYSTEM, DISPLAY]]);
    h.caffeine.setOption('onlyOnAC', true);
    assertEqual(h.held(), []);
    h.dispose();
});

// Actions, menu, pill.

test('the actions follow the state', async () => {
    const h = harness();
    assertEqual([h.action('caffeine.extend:10'), h.action('caffeine.off'), h.action('caffeine.on:1h').title], [undefined, undefined, 'Keep awake for 1 hour']);
    h.action('caffeine.on:1h').run();
    await settle();
    assertEqual(h.toast(), 'Caffeine on · for 1 hour');
    assertEqual([h.action('caffeine.extend:10').title, h.action('caffeine.extend:60').title, h.action('caffeine.off').subtitle],
        ['Add 10 min to caffeine', 'Add 1 hour to caffeine', 'allow sleep again']);
    h.action('caffeine.on:until-off').run();
    assertEqual(h.action('caffeine.extend:10'), undefined);
    h.action('caffeine.off').run();
    assertEqual(h.caffeine.isOn, false);
    h.dispose();
});

test('Ctrl+Enter on the Caffeine tab starts with the selected duration, then stops', () => {
    const h = harness();
    h.app.hud.focus('caffeine');
    assertEqual([h.app.handleKey({key: 'Return', ctrl: true}, true), h.caffeine.isOn], [true, true]);
    h.app.handleKey({key: 'Return', ctrl: true}, true);
    assertEqual(h.caffeine.isOn, false);
    assertEqual([h.app.handleKey({key: 'Right', alt: true}, true), h.caffeine.lastDuration], [true, '2h']);
    h.minutes(1);
    assertEqual(h.app.footer().hints.map(x => x.label), ['choose', 'start', 'close']);
    h.dispose();
});

test('Ctrl+Enter with text in the prompt is the prompt\'s: Caffeine stays as it is (Rev 1)', () => {
    const h = harness();
    h.app.hud.focus('caffeine');
    h.app.hud.setInput('awake');
    assertEqual([h.app.handleKey({key: 'Return', ctrl: true}, false), h.caffeine.isOn], [false, false]);
    h.dispose();
});

test('the pill shows the time left', () => {
    const h = harness();
    assertEqual(h.caffeine.pill(h.now()), null);
    h.caffeine.selectDuration('1h');
    assertEqual(h.caffeine.pill(h.now() + 2 * 60_000), 'Awake 58m');
    h.dispose();
});

// The Caffeine tab.

test('off: the switch off and no extend row', () => {
    const h = harness();
    const screen = h.caffeine.screen(h.now());
    assertEqual([screen.header.title, screen.header.subtitle, screen.header.isOn, screen.header.chipAccent, screen.extend],
        ['Caffeine is off', 'Your computer dims the screen and sleeps as usual.', false, false, null]);
    assertEqual(screen.durations.map(d => d.title), ['15 min', '1 hour', '2 hours', 'Until off']);
    assertEqual(screen.durations.find(d => d.selected).duration, '1h');
    assertEqual(screen.options.map(o => o.title), ['Keep the screen on', 'Prevent system sleep', 'Only on power adapter']);
    h.dispose();
});

test('on: the time left and when it ends, in GNOME\'s clock format', async () => {
    const h = harness();
    h.caffeine.selectDuration('1h');
    await settle();
    const screen = h.caffeine.screen(h.now() + 15 * 60_000);
    const endsAt = format.time(new Date(h.caffeine.endsAt), '24h');
    assertEqual([screen.header.title, screen.header.subtitle, screen.header.chipAccent, screen.header.pauseBadge],
        ['Staying awake', `45m left · ends at ${endsAt}`, true, false]);
    assertEqual(screen.extend.buttons, [{minutes: 10, title: '+10 min'}, {minutes: 60, title: '+1 h'}]);
    h.caffeine.selectDuration('until-off');
    assertEqual([h.caffeine.screen(h.now()).header.subtitle, h.caffeine.screen(h.now()).extend], ['Until you turn it off', null]);
    h.dispose();
});

test('paused on battery reads as designed', () => {
    const h = harness({settings: {'only-on-ac': true}, onBattery: true});
    h.caffeine.selectDuration('1h');
    const header = h.caffeine.screen(h.now() + 15 * 60_000).header;
    assertEqual([header.title, header.subtitle.startsWith('Resumes on power · 45m left · ends at '), header.isOn, header.chipAccent, header.pauseBadge],
        ['Paused on battery', true, true, false, true]);
    h.caffeine.selectDuration('until-off');
    assertEqual(h.caffeine.screen(h.now()).header.subtitle, 'Resumes on power');
    h.dispose();
});

test('the last option on is disabled, with its tooltip', () => {
    const h = harness();
    h.caffeine.setOption('preventSystemSleep', false);
    const rows = h.caffeine.screen(h.now()).options;
    assertEqual([rows[0].isOn, rows[0].enabled, rows[0].disabledHelp, rows[1].isOn, rows[1].enabled, rows[2].enabled],
        [true, false, 'Keep at least one on.', false, true, true]);
    h.dispose();
});

// Refusals.

test('when GNOME refuses everything, Caffeine is off with the note, and no "on" toast', async () => {
    const h = harness();
    h.ports.inhibitor.refuse = new Set([DISPLAY, SYSTEM]);
    h.app.hud.toast('before');
    h.caffeine.toggle();
    assertEqual(h.caffeine.isOn, true, 'on at once, pending');
    await settle();
    assertEqual([h.caffeine.isOn, h.caffeine.state.problem, h.toast(), h.caffeine.pill(h.now())], [false, 'refused', 'before', null]);
    assertEqual(h.app.indicator.state.parts.length, 1, 'no cup');
    const screen = h.caffeine.screen(h.now());
    assertEqual([screen.header.title, screen.holdNote], ['Caffeine is off', {text: "GNOME didn't let HeadsUp keep your computer awake.", tryAgain: 'Try Again'}]);
    h.dispose();
});

test('Try Again starts with the same duration and clears the note; any other start does too', async () => {
    const h = harness();
    h.ports.inhibitor.refuse = new Set([DISPLAY, SYSTEM]);
    h.caffeine.selectDuration('2h');
    await settle();
    h.ports.inhibitor.refuse.clear();
    h.caffeine.retry();
    await settle();
    assertEqual([h.caffeine.isOn, h.caffeine.endsAt, h.caffeine.state.problem, h.toast()],
        [true, h.now() + 2 * 3_600_000, null, 'Caffeine on. Your computer stays awake']);
    h.dispose();
});

test('when one of two is refused, Caffeine stays on with the other and names it', async () => {
    const h = harness();
    h.ports.inhibitor.refuse = new Set([DISPLAY]);
    h.caffeine.toggle();
    await settle();
    assertEqual([h.caffeine.isOn, h.held(), h.caffeine.state.problem], [true, [SYSTEM], 'displayRefused']);
    assertEqual(h.caffeine.screen(h.now()).holdNote.text, "GNOME didn't let HeadsUp keep the screen on.");
    h.dispose();
});

test('turning on while paused on battery says so; paused isn\'t refused', async () => {
    const h = harness({settings: {'only-on-ac': true}, onBattery: true});
    h.caffeine.toggle();
    await settle();
    assertEqual(h.toast(), 'Caffeine on · paused until you plug in');
    h.caffeine.turnOff();
    h.caffeine.selectDuration('1h');
    assertEqual(h.toast(), 'Caffeine on · 1 hour · paused until you plug in');
    h.caffeine.turnOff();
    h.caffeine.keepAwake('2h');
    assertEqual([h.toast(), h.caffeine.state.problem], ['Caffeine on · for 2 hours · paused until you plug in', null]);
    h.dispose();
});

test('a partial note clears when everything wanted is held, or Caffeine turns off', async () => {
    const h = harness();
    h.ports.inhibitor.refuse = new Set([DISPLAY]);
    h.caffeine.toggle();
    await settle();
    h.caffeine.setOption('keepDisplayOn', false);
    await settle();
    assertEqual(h.caffeine.state.problem, null);
    h.caffeine.setOption('keepDisplayOn', true);
    await settle();
    h.caffeine.turnOff();
    assertEqual(h.caffeine.state.problem, null);
    h.dispose();
});

test('a partial note is kept through a pause and clears when a later ask works', async () => {
    const h = harness({settings: {'only-on-ac': true}});
    h.ports.inhibitor.refuse = new Set([DISPLAY]);
    h.caffeine.toggle();
    await settle();
    h.ports.power.set(true);
    assertEqual(h.caffeine.state.problem, 'displayRefused');
    h.ports.inhibitor.refuse.clear();
    h.ports.power.set(false);
    await settle();
    assertEqual([h.caffeine.state.problem, h.held()], [null, [SYSTEM, DISPLAY]]);
    h.dispose();
});

test('the end clears the note; Try Again while on keeps the countdown', async () => {
    const h = harness();
    h.ports.inhibitor.refuse = new Set([DISPLAY]);
    h.caffeine.selectDuration('2h');
    await settle();
    const endsAt = h.caffeine.endsAt;
    h.minutes(30);
    h.ports.inhibitor.refuse.clear();
    h.caffeine.retry();
    await settle();
    assertEqual([h.caffeine.endsAt, h.caffeine.state.problem, h.held()], [endsAt, null, [SYSTEM, DISPLAY]]);
    h.ports.inhibitor.refuse = new Set([DISPLAY]);
    h.caffeine.selectDuration('15m');
    await settle();
    h.minutes(15);
    assertEqual([h.caffeine.isOn, h.caffeine.state.problem], [false, null]);
    h.dispose();
});

test('the menu switch and the indicator follow Caffeine', async () => {
    const h = harness();
    h.caffeine.toggle();
    await settle();
    assertEqual(h.app.indicator.state.parts, [{kind: 'timer', text: 'Idle', warning: false}, {kind: 'cup', text: '1h 00m', accent: true}]);
    assertEqual(h.app.indicator.state.accessibleName, 'HeadsUp, idle, caffeine on, 1 hour left');
    h.dispose();
});
