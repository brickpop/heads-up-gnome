// The Focus tab's screen model and the keys' picks: the Mac's FocusScreenTests,
// BackPromptLengthTests and SnoozeSelectionTests (their store parts), ported.

import {test, assertEqual, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import * as format from '../../lib/core/format.js';

function harness(settings = {}) {
    const ports = testPorts({settings, state: {'welcome-done': true}});
    const app = createApp(ports);
    return {
        ports, app, focus: app.focus,
        minutes: m => ports.clock.advance(m * 60_000),
        now: () => ports.clock.now().getTime(),
        screen: () => app.focus.screen(ports.clock.now().getTime()),
    };
}

const selected = cards => cards.find(c => c.selected)?.minutes;

test('idle shows the selected length and today\'s stats', () => {
    const h = harness();
    const idle = h.screen();
    assertEqual([idle.kind, idle.label, idle.timer, idle.today], ['idle', 'Focus session', '25:00', '0 sessions · 0m focused today']);
    assertEqual(idle.lengths.map(c => [c.title, c.hint, c.selected]), [['25 min', 'Classic pomodoro', true], ['40 min', 'Steady block', false], ['50 min', 'Deep work', false]]);
    assertEqual(idle.lengths.map(c => c.accessibleName), ['25 min, Classic pomodoro, selected', '40 min, Steady block', '50 min, Deep work']);
    assertEqual([idle.breaksOffer, idle.start], ['Breaks offer: look elsewhere, drink water, stretch your arms…', 'Start focus']);
    h.app.dispose();
});

test('a running focus says when the break comes, in GNOME\'s clock format', () => {
    const h = harness();
    h.focus.start();
    const start = h.now();
    const running = h.focus.screen(start + 60_000);
    const breakAt = format.time(new Date(start + 25 * 60_000), '24h');
    assertEqual([running.label, running.timer, running.timerAccessible], ['Focusing', '24:00', '24 minutes left']);
    assertEqual(running.subtitle, `25 min session · break at ${breakAt}`);
    assertEqual([running.stop.action, running.stop.title, running.end.action, running.end.title], ['stopNow', 'Stop now', 'takeBreak', 'Take a break']);
    assertEqual([running.pauseTitle, running.pauseGlyph, Math.abs(running.progress - 1 / 25) < 1e-9], ['Pause', 'pause', true]);
    h.app.dispose();
});

test('paused and break titles; Skip break from the screen\'s button', () => {
    const h = harness();
    h.focus.start();
    h.focus.togglePause();
    const paused = h.screen();
    assertEqual([paused.label, paused.pauseTitle, paused.pauseGlyph], ['Focus · paused', 'Resume', 'play-circle']);
    h.focus.togglePause();
    assertEqual(h.focus.snapshot.kind, 'running');
    h.focus.takeBreakNow();
    h.focus.startBreak();
    const rest = h.screen();
    assertEqual([rest.label, rest.subtitle, rest.stop, rest.end.action], ['Break · Drink water', 'Step away. The HUD will call you back.', null, 'skipBreak']);
    h.focus.run(rest.end.action);
    assertEqual(h.focus.phase.prompt.kind, 'back');
    h.app.dispose();
});

test('Take a break and Stop now during a focus count nothing', () => {
    for (const action of ['takeBreak', 'stopNow']) {
        const h = harness();
        h.focus.start();
        h.minutes(10);
        h.focus.run(action);
        assertEqual([h.focus.phase.kind, h.focus.today], [action === 'takeBreak' ? 'prompt' : 'idle', {sessions: 0, minutes: 0}]);
        h.app.dispose();
    }
});

test('the break prompts: labels, options, lengths, snooze group', () => {
    const h = harness();
    h.focus.start();
    h.minutes(25);
    const auto = h.screen();
    assertEqual([auto.kind, auto.label, auto.title], ['breakPrompt', '25 min session done · 1 today', 'Time for a break']);
    assertEqual(auto.options.find(o => o.selected).id, 'water');
    assertEqual(auto.options.slice(0, 2).map(o => o.accessibleName), ['Look elsewhere, 2 min', 'Drink water, 5 min, selected']);
    assertEqual([auto.lengths.map(l => l.minutes), selected(auto.lengths), auto.selectedLength], [[2, 5, 10, 20, 50], 5, 5]);
    assertEqual([selected(auto.snooze.choices), auto.snooze.stopNow, auto.startBreak], [5, 'Stop now', 'Start break']);
    h.focus.setBreakLength(20);
    assertEqual(h.screen().selectedLength, 20);
    h.focus.takeBreakNow();
    assertEqual(h.screen().label, '1 session · 25m focused today');
    h.app.dispose();
});

test('a manual prompt before any session says so', () => {
    const h = harness();
    h.focus.takeBreakNow();
    assertEqual(h.screen().label, 'No sessions yet today');
    h.app.dispose();
});

test('the back prompt and snoozed screens', () => {
    const h = harness();
    h.focus.takeBreakNow();
    h.focus.startBreak();
    h.minutes(5);
    const back = h.screen();
    assertEqual([back.kind, back.label, back.title, back.start], ['backPrompt', 'Break finished', 'Ready to get back to it?', 'Start focus']);
    h.focus.snooze();
    const snoozed = h.focus.screen(h.now() + 48_000);
    assertEqual([snoozed.title, snoozed.showNow], ['Prompt returns in 4:12', 'Show now']);
    h.app.dispose();
});

// The back prompt's lengths.

const backPrompt = after => {
    const h = harness();
    h.focus.start(after);
    h.minutes(after);
    h.focus.startBreak();
    h.minutes(5);
    return h;
};

test('the back prompt selects the last focus\'s preset, the setting stays', () => {
    const h = backPrompt(40);
    const back = h.screen();
    assertEqual([back.lengths.map(c => c.minutes), selected(back.lengths), h.focus.focusLength], [[25, 40, 50], 40, 25]);
    assertEqual(back.lengths[1].accessibleName, '40 min, Steady block, selected');
    h.app.dispose();
});

test('a typed length shows as an extra card, selected', () => {
    const h = backPrompt(35);
    const back = h.screen();
    assertEqual([back.lengths.map(c => c.minutes), selected(back.lengths), back.lengths[1].hint], [[25, 35, 40, 50], 35, 'Last focus']);
    h.app.dispose();
});

test('without a focus yet, the setting\'s length is selected', () => {
    const h = harness();
    h.focus.setFocusLength(40);
    h.focus.takeBreakNow();
    h.focus.startBreak();
    h.minutes(5);
    assertEqual(selected(h.screen().lengths), 40);
    h.app.dispose();
});

test('Alt+arrows move the back prompt\'s selection, stopping at the ends', () => {
    const h = backPrompt(35);
    assertEqual(h.focus.moveCardSelection(1), true);
    assertEqual(selected(h.screen().lengths), 40);
    h.focus.moveCardSelection(1);
    h.focus.moveCardSelection(1);
    assertEqual([selected(h.screen().lengths), h.focus.state.cardMoves], [50, 2]);
    h.focus.moveCardSelection(-1);
    assertEqual([selected(h.screen().lengths), h.focus.focusLength], [40, 25]);
    h.app.dispose();
});

test('Ctrl+Enter and the button start the selected length', () => {
    const h = backPrompt(35);
    h.focus.setNextFocusLength(50);
    assertEqual(h.focus.runPrimaryAction(), true);
    assertEqual([h.focus.phase.run.minutes, h.focus.focusLength], [50, 25]);
    h.app.dispose();
    const clicked = backPrompt(40);
    clicked.focus.start();
    assertEqual(clicked.focus.phase.run.minutes, 40);
    clicked.app.dispose();
});

test('a length that isn\'t a card is refused', () => {
    const h = backPrompt(25);
    h.focus.setNextFocusLength(50);
    h.focus.setNextFocusLength(35);
    assertEqual(selected(h.screen().lengths), 50);
    h.app.dispose();
});

test('the pick survives a snooze, not the next round', () => {
    const h = backPrompt(25);
    h.focus.setNextFocusLength(50);
    h.focus.snooze();
    h.focus.showNow();
    assertEqual(selected(h.screen().lengths), 50);
    h.focus.doneForNow();
    h.focus.takeBreakNow();
    h.focus.startBreak();
    h.minutes(5);
    assertEqual(selected(h.screen().lengths), 25);
    h.app.dispose();
});

test('Start Focus from the notification starts the back prompt\'s length', () => {
    for (const pick of [null, 50]) {
        const h = backPrompt(35);
        if (pick)
            h.focus.setNextFocusLength(pick);
        h.ports.notifier.answer('focus.timer', 'start-focus');
        assertEqual([h.focus.phase.run.minutes, h.focus.focusLength], [pick ?? 35, 25]);
        h.app.dispose();
    }
});

test('an auto-started focus has the last focus\'s length', () => {
    const h = harness();
    h.focus.editor.setAutoStartNextFocus(true);
    h.focus.start(35);
    h.minutes(35);
    h.focus.startBreak();
    h.minutes(5);
    assertEqual([h.focus.phase.run.minutes, h.app.hud.state.toast?.text, h.focus.focusLength], [35, 'Focus started · 35 min', 25]);
    h.app.dispose();
});

// Idle and break-prompt cards, snooze picks.

test('idle: Alt+arrows pick a focus length (the setting) and stop at the ends', () => {
    const h = harness();
    h.focus.moveCardSelection(-1);
    assertEqual([h.focus.focusLength, h.focus.state.cardMoves], [25, 0]);
    h.focus.moveCardSelection(1);
    h.focus.moveCardSelection(1);
    h.focus.moveCardSelection(1);
    assertEqual(h.focus.focusLength, 50);
    h.app.dispose();
});

test('break prompt: Alt+arrows pick an option and its length; running: not handled', () => {
    const h = harness();
    h.focus.takeBreakNow();
    h.focus.moveCardSelection(-1);
    assertEqual([h.focus.activity.id, h.focus.breakLength], ['look', 2]);
    h.focus.startBreak();
    assertEqual(h.focus.moveCardSelection(1), false);
    h.app.dispose();
});

test('the snooze pick starts at the setting, moves, snoozes for itself, and resets on the next prompt', () => {
    const h = harness({'snooze-minutes': 5});
    assertEqual(h.focus.moveSnoozeSelection(1), false, 'only the prompts have it');
    h.focus.takeBreakNow();
    assertEqual(h.focus.selectedSnoozeMinutes, 5);
    h.focus.moveSnoozeSelection(1);
    h.focus.moveSnoozeSelection(1);
    assertEqual([h.focus.selectedSnoozeMinutes, h.focus.state.snoozeMoves], [10, 1]);
    h.focus.snooze();
    assertEqual(h.focus.snapshot.until, h.now() + 10 * 60_000);
    h.focus.showNow();
    assertEqual(h.focus.selectedSnoozeMinutes, 5, 'the next prompt starts from the setting');
    h.focus.selectSnooze(2);
    h.focus.snooze(10);
    assertEqual(h.focus.snapshot.until, h.now() + 10 * 60_000, 'a click snoozes for its own length');
    h.app.dispose();
});

test('Ctrl+Enter: idle starts, the break prompt starts the break, snoozed shows now, running has none', () => {
    const h = harness();
    assertEqual([h.focus.runPrimaryAction(), h.focus.phase.kind], [true, 'focus']);
    assertEqual(h.focus.runPrimaryAction(), false);
    h.focus.takeBreakNow();
    h.focus.runPrimaryAction();
    assertEqual(h.focus.phase.kind, 'rest');
    h.focus.skipBreak();
    h.focus.snooze();
    h.focus.runPrimaryAction();
    assertEqual(h.focus.phase.kind, 'prompt');
    h.app.dispose();
});
