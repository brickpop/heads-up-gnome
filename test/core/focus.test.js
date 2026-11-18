// FocusStore: the Mac's FocusStoreTests, FocusReviewTests and FocusHideAfterStartTests,
// ported to GNOME (a notification posts when its end comes; there is no pending one).

import {test, assertEqual, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {liveHandles} from '../fakes.js';

const BREAK_DUE = {kind: 'prompt', prompt: {kind: 'break', manual: false}};
const MANUAL_PROMPT = {kind: 'prompt', prompt: {kind: 'break', manual: true}};
const BACK = {kind: 'prompt', prompt: {kind: 'back'}};

function harness({settings = {}, state = {}} = {}) {
    const ports = testPorts({settings, state: {'welcome-done': true, ...state}});
    const app = createApp(ports);
    const h = {
        ports, app, focus: app.focus, hud: app.hud, clock: ports.clock, notifier: ports.notifier,
        /** Time passes by `count` minutes: the wake-ups fire. */
        minutes: count => ports.clock.advance(count * 60_000),
        seconds: count => ports.clock.advance(count * 1000),
        now: () => ports.clock.now().getTime(),
        get shown() {
            return ports.notifier.shown.get('focus.timer') ?? null;
        },
        answer: action => ports.notifier.answer('focus.timer', action),
        dispose: () => app.dispose(),
    };
    return h;
}

const minutesFrom = (h, m) => h.now() + m * 60_000;

// A whole round.

test('starting a focus toasts and shows as running', () => {
    const h = harness();
    h.focus.start();
    assertEqual(h.hud.state.toast?.text, 'Focus started · 25 min');
    assertEqual(h.focus.snapshot, {kind: 'running', run: 'focus', endsAt: minutesFrom(h, 25)});
    assertEqual(h.shown, null, 'nothing posts before the end');
    h.dispose();
});

test('a focus that ends counts the session, posts, and opens the HUD without the grab', () => {
    const h = harness();
    h.focus.start(40);
    h.minutes(40);
    assertEqual(h.focus.phase, BREAK_DUE);
    assertEqual(h.focus.today, {sessions: 1, minutes: 40});
    assertEqual([h.shown.category, h.shown.title, h.shown.body], ['focus.end', 'Focus done · 40 min', 'Time for a break.']);
    assertEqual(h.shown.actions, [{id: 'start-break', label: 'Start Break'}, {id: 'snooze', label: 'Snooze'}, {id: 'done', label: 'Stop Now'}]);
    assertEqual([h.hud.state.visible, h.hud.state.focused, h.hud.state.tab], [true, false, 'focus']);
    h.dispose();
});

test('with open-hud-on-end off, only the notification tells the user', () => {
    const h = harness({settings: {'open-hud-on-end': false}});
    h.focus.start();
    h.minutes(25);
    assertEqual([h.focus.phase, h.hud.state.visible, h.shown?.category], [BREAK_DUE, false, 'focus.end']);
    h.dispose();
});

test('a break runs and brings the back prompt', () => {
    const h = harness();
    h.focus.start();
    h.minutes(25);
    h.focus.selectActivity('look');
    assertEqual(h.focus.breakLength, 2);
    h.focus.setBreakLength(10);
    h.focus.startBreak();
    assertEqual(h.hud.state.toast?.text, 'Break started · 10 min');
    assertEqual(h.shown, null, 'the break prompt was answered');
    h.hud.hide();
    h.minutes(10);
    assertEqual(h.focus.phase, BACK);
    assertEqual([h.shown.category, h.shown.title, h.shown.body], ['break.end', 'Break over', 'Ready to get back to it?']);
    assertEqual([h.hud.state.visible, h.hud.state.tab], [true, 'focus']);
    h.dispose();
});

test('with auto-start, the next focus starts and the notification says so', () => {
    const h = harness();
    h.focus.editor.setAutoStartNextFocus(true);
    h.focus.start();
    h.minutes(25);
    h.focus.startBreak();
    h.hud.hide();
    h.minutes(5);
    assertEqual(h.focus.snapshot, {kind: 'running', run: 'focus', endsAt: minutesFrom(h, 25)});
    assertEqual([h.shown.category, h.shown.body], ['break.autostart', 'Focus started · 25 min']);
    assertEqual(h.shown.actions.map(a => a.label), ['Stop']);
    assertEqual([h.hud.state.visible, h.hud.state.toast?.text], [false, 'Focus started · 25 min']);
    h.dispose();
});

// Pause, stop, snooze.

test('pause stops the wake-up; resume brings it back', () => {
    const h = harness();
    h.focus.start();
    h.minutes(10);
    h.focus.pause();
    h.minutes(60);
    assertEqual(h.focus.snapshot, {kind: 'paused', run: 'focus', left: 15 * 60});
    h.focus.resume();
    h.minutes(15);
    assertEqual(h.focus.phase, BREAK_DUE);
    h.dispose();
});

test('stop goes idle and counts nothing', () => {
    const h = harness();
    h.focus.start();
    h.focus.stop();
    h.minutes(30);
    assertEqual([h.focus.phase.kind, h.focus.today, h.shown], ['idle', {sessions: 0, minutes: 0}, null]);
    h.dispose();
});

test('snooze toasts, hides the HUD after 600 ms, and brings the prompt back', () => {
    const h = harness({settings: {'snooze-minutes': 2}});
    h.focus.start();
    h.minutes(25);
    h.hud.focus('focus');
    h.focus.snooze();
    assertEqual([h.hud.state.toast?.text, h.hud.state.visible], ['Snoozed for 2 min', true]);
    h.seconds(0.6);
    assertEqual(h.hud.state.visible, false);
    assertEqual(h.focus.snapshot, {kind: 'snoozed', until: h.now() - 600 + 2 * 60_000, prompt: 'breakDue'});
    h.minutes(2);
    assertEqual([h.focus.phase, h.hud.state.visible, h.hud.state.tab], [BREAK_DUE, true, 'focus']);
    assertEqual([h.shown.title, h.shown.body], ['Time for a break', 'Snooze is over. Your 25 min focus is done.']);
    h.dispose();
});

test('a snoozed back prompt is posted again at the snooze end, HUD or not', () => {
    for (const open of [true, false]) {
        const h = harness({settings: {'open-hud-on-end': open}});
        h.focus.takeBreakNow();
        h.focus.startBreak();
        h.minutes(5);
        h.hud.hide();
        h.answer('snooze');
        assertEqual(h.shown, null, 'answered');
        h.minutes(5);
        assertEqual([h.shown.category, h.shown.title, h.shown.body], ['break.end', 'Break over', 'Snooze is over. Ready to get back to it?']);
        assertEqual(h.hud.state.visible, open);
        h.dispose();
    }
});

test('a snoozed manual prompt has no session length to name', () => {
    const h = harness();
    h.focus.takeBreakNow();
    h.focus.snooze();
    h.minutes(5);
    assertEqual([h.shown.title, h.shown.body, h.shown.category], ['Time for a break', 'Snooze is over.', 'focus.end']);
    h.dispose();
});

// Notifications.

test('a notification stays until its prompt is answered', () => {
    const h = harness();
    h.focus.start();
    h.minutes(25);
    h.focus.selectActivity('look');
    assertEqual(h.shown?.category, 'focus.end', 'picking an activity isn\'t an answer');
    h.focus.showNow();
    h.focus.skipBreak();
    assertEqual(h.shown?.category, 'focus.end', 'moves that don\'t apply change nothing');
    h.focus.takeBreakNow();
    assertEqual(h.shown, null, 'the prompt gave way to a manual one');
    h.dispose();
});

test('Start Break, Snooze, Start Focus and Stop from a notification', () => {
    const h = harness();
    h.focus.start();
    h.minutes(25);
    h.answer('start-break');
    assertEqual(h.focus.snapshot, {kind: 'running', run: 'rest', endsAt: minutesFrom(h, 5)});
    h.minutes(5);
    h.answer('start-focus');
    assertEqual(h.focus.snapshot, {kind: 'running', run: 'focus', endsAt: minutesFrom(h, 25)});
    h.notifier.post({id: 'focus.timer', category: 'break.autostart', title: '', body: '', actions: []});
    h.answer('stop');
    assertEqual(h.focus.phase.kind, 'idle');
    h.dispose();
});

test('a notification answered after a suspend first catches up', () => {
    const h = harness();
    h.focus.start();
    // Suspended through the end: the wake-up didn't fire, the clock moved on.
    h.clock.jump(30 * 60_000);
    h.focus.handleNotification({id: 'focus.timer', category: 'focus.end', action: 'snooze'});
    assertEqual(h.focus.snapshot, {kind: 'snoozed', until: minutesFrom(h, 5), prompt: 'breakDue'});
    assertEqual(h.focus.today.sessions, 1);
    h.dispose();
});

test('old, unknown or foreign answers do nothing', () => {
    const h = harness();
    const answers = [
        ['focus.timer', 'focus.end', 'start-break'],
        ['focus.timer', 'focus.end', 'stop'],
        ['focus.timer', 'focus.ending', 'snooze'],
        ['focus.timer', 'break.end', 'start-focus; rm'],
        ['focus.timer', 'break.end', ''],
        ['service.failed:x', 'service.failed', null],
    ];
    for (const [id, category, action] of answers)
        h.focus.handleNotification({id, category, action});
    assertEqual([h.focus.phase.kind, h.hud.state.visible], ['idle', false]);
    h.focus.takeBreakNow();
    h.focus.handleNotification({id: 'focus.timer', category: 'break.autostart', action: 'stop'});
    assertEqual(h.focus.phase, MANUAL_PROMPT, 'Stop from an auto-start notification does nothing at a prompt');
    h.dispose();
});

test('a click on the body opens the HUD on Focus with the grab', () => {
    const h = harness();
    h.focus.handleNotification({id: 'focus.timer', category: 'break.end', action: null});
    assertEqual([h.hud.state.visible, h.hud.state.focused, h.hud.state.tab], [true, true, 'focus']);
    h.dispose();
});

test('while locked, notification answers are ignored (G2)', () => {
    const h = harness();
    h.focus.start();
    h.minutes(25);
    h.ports.session.lock();
    h.answer('start-break');
    h.answer(null);
    assertEqual([h.focus.phase, h.hud.state.visible], [BREAK_DUE, false]);
    h.ports.session.unlock();
    h.dispose();
});

test('a focus that ends while locked opens the HUD after unlock, on Focus', () => {
    const h = harness();
    h.focus.start();
    h.ports.session.lock();
    h.minutes(25);
    assertEqual([h.focus.phase, h.ports.hud.visible, h.shown?.category], [BREAK_DUE, false, 'focus.end']);
    h.ports.session.unlock();
    assertEqual([h.ports.hud.visible, h.hud.state.tab], [true, 'focus']);
    h.dispose();
});

// Auto-open by the HUD's state.

test('an open HUD in use stays and toasts; a snoozed prompt returning toasts its title', () => {
    const h = harness();
    h.focus.start();
    h.hud.focus('chat');
    h.minutes(25);
    assertEqual([h.hud.state.tab, h.hud.state.focused, h.hud.state.toast?.text], ['chat', true, 'Focus done · time for a break']);
    h.focus.snooze();
    h.seconds(1);
    h.hud.focus('chat');
    h.minutes(5);
    assertEqual([h.hud.state.tab, h.hud.state.toast?.text], ['chat', 'Time for a break']);
    h.dispose();
});

// Days.

test('today\'s stats count on the day the focus ended, and reset at local midnight', () => {
    const h = harness();
    h.focus.start();
    h.minutes(25);
    h.focus.doneForNow();
    h.focus.start(40);
    h.minutes(40);
    assertEqual(h.focus.today, {sessions: 2, minutes: 65});
    h.minutes(24 * 60);
    assertEqual(h.focus.today, {sessions: 0, minutes: 0});
    h.dispose();
});

test('after a suspend the end happens when the wake-up fires, late, counted on its day', () => {
    const h = harness();
    h.focus.start();
    h.minutes(180);
    assertEqual([h.focus.phase, h.focus.today.sessions], [BREAK_DUE, 1]);
    h.dispose();
});

// Preferences → Focus.

test('the last break option can\'t be removed', () => {
    const h = harness();
    for (const id of ['look', 'water', 'stretch', 'friends', 'lunch'])
        h.focus.editor.removeBreakOption(id);
    assertEqual([h.focus.settings.breakOptions.map(o => o.id), h.focus.activity.id], [['lunch'], 'lunch']);
    h.dispose();
});

test('an option\'s length cycles through the allowed lengths', () => {
    const h = harness();
    const lengths = [];
    for (let i = 0; i < 5; i++) {
        h.focus.editor.cycleBreakOptionLength('look');
        lengths.push(h.focus.settings.breakOptions[0].minutes);
    }
    assertEqual(lengths, [5, 10, 20, 50, 2]);
    h.dispose();
});

test('adding an option needs a label and gets the dot and a custom id', () => {
    const h = harness();
    h.focus.editor.addBreakOption('   ', 5);
    assertEqual(h.focus.settings.breakOptions.length, 5);
    h.focus.editor.addBreakOption('Walk around the block', 20);
    const added = h.focus.settings.breakOptions.at(-1);
    assertEqual([added.label, added.icon, added.minutes, /^custom-[0-9a-f-]{36}$/.test(added.id)], ['Walk around the block', 'dot', 20, true]);
    h.dispose();
});

test('lengths outside their sets are refused', () => {
    const h = harness();
    h.focus.setFocusLength(33);
    h.focus.editor.setSnoozeMinutes(7);
    h.focus.setBreakLength(3);
    assertEqual([h.focus.focusLength, h.focus.settings.snoozeMinutes, h.focus.breakLength], [25, 5, 5]);
    h.focus.setFocusLength(50);
    assertEqual(h.focus.snapshot, {kind: 'idle', nextLength: 50});
    h.dispose();
});

// The pill.

test('the pill counts down', () => {
    const h = harness();
    assertEqual(h.focus.pill(h.now()), null);
    h.focus.start();
    assertEqual(h.focus.pill(h.now() + (6 * 60 + 18) * 1000), 'Focus 18:42');
    h.minutes(25);
    h.focus.snooze();
    assertEqual(h.focus.pill(h.now() + 48_000), 'Snoozed 4:12');
    h.dispose();
});

// Hide after a start from the HUD.

test('a start from the HUD hides it after 1.5 s', () => {
    const h = harness();
    h.hud.focus('focus');
    h.focus.start();
    h.seconds(1.4);
    assertEqual(h.hud.state.visible, true);
    h.seconds(0.1);
    assertEqual(h.hud.state.visible, false);
    h.dispose();
});

test('a tab switch or cancelHideSoon (typing) keeps it open', () => {
    const h = harness();
    h.hud.focus('focus');
    h.focus.start();
    h.focus.cancelHideSoon();
    h.seconds(2);
    assertEqual(h.hud.state.visible, true, 'typing');
    h.focus.stop();
    h.focus.start();
    h.hud.selectTab('chat');
    h.seconds(2);
    assertEqual(h.hud.state.visible, true, 'tab switch');
    h.dispose();
});

test('a start from a notification or with a length (the tool) doesn\'t hide the HUD', () => {
    const h = harness();
    h.hud.focus('chat');
    h.focus.start(25);
    h.seconds(2);
    assertEqual(h.hud.state.visible, true);
    h.minutes(25);
    h.answer('start-break');
    h.seconds(2);
    assertEqual(h.hud.state.visible, true);
    h.dispose();
});

test('with the screen reader on, a start leaves the HUD open', () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp({...ports, screenReaderOn: () => true});
    app.hud.focus('focus');
    app.focus.start();
    ports.clock.advance(2000);
    assertEqual(app.hud.state.visible, true);
    app.dispose();
});

test('a start right after Snooze replaces its hide', () => {
    const h = harness();
    h.focus.start();
    h.minutes(25);
    h.hud.focus('focus');
    h.focus.snooze();
    h.seconds(0.59);
    h.focus.start();
    h.seconds(0.01);
    assertEqual(h.hud.state.visible, true, 'the snooze hide is gone');
    h.seconds(1.48);
    assertEqual(h.hud.state.visible, true);
    h.seconds(0.02);
    assertEqual(h.hud.state.visible, false);
    h.dispose();
});

test('Stop now doesn\'t hide, and a closed HUD isn\'t hidden later', () => {
    const h = harness();
    h.focus.start();
    h.hud.focus('focus');
    h.seconds(2);
    assertEqual(h.hud.state.visible, true);
    h.minutes(25);
    h.focus.doneForNow();
    h.seconds(2);
    assertEqual([h.hud.state.visible, h.focus.phase.kind], [true, 'idle']);
    h.dispose();
});

test('dispose ends the timer: no live handle, the notification withdrawn', () => {
    const h = harness();
    h.focus.start();
    h.hud.focus('focus');
    h.focus.start();
    h.minutes(25);
    h.dispose();
    assertEqual([liveHandles(h.ports), h.shown], [{}, null]);
});
