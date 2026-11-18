// The Mac's FocusMachineTests, ported (debug quick timers aren't).

import {test, assertEqual} from '../harness.js';
import {BACK_PROMPT, FocusMachine, IDLE, breakPrompt, progress, runningRun, timeLeft} from '../../lib/core/focusMachine.js';

const t0 = 1_800_000_000_000;
const at = minutes => t0 + minutes * 60_000;
const run = (minutes, endsAt, pausedLeft = null) => ({minutes, duration: minutes * 60_000, endsAt, pausedLeft});
const focus = r => ({kind: 'focus', run: r});
const rest = (r, activity) => ({kind: 'rest', run: r, activity});
const prompt = p => ({kind: 'prompt', prompt: p});
const snoozed = (until, p) => ({kind: 'snoozed', until, prompt: p});
const machine = (phase = IDLE) => new FocusMachine(Object.freeze(phase));

test('a focus runs to its end and counts a session', () => {
    const m = machine();
    m.start(25, t0);
    assertEqual(m.phase, focus(run(25, at(25))));
    assertEqual(m.nextDeadline, at(25));
    assertEqual(m.advance(at(24.9), null), null);
    assertEqual(m.advance(at(25), null), {kind: 'focusCompleted', minutes: 25, endedAt: at(25)});
    assertEqual(m.phase, prompt(breakPrompt(false)));
    assertEqual(m.nextDeadline, null);
});

test('a break runs to the back prompt', () => {
    const m = machine(prompt(breakPrompt(false)));
    m.startBreak('water', 5, t0);
    assertEqual(m.phase, rest(run(5, at(5)), 'water'));
    assertEqual(m.advance(at(5), null), {kind: 'breakCompleted', autoStartedMinutes: null});
    assertEqual(m.phase, prompt(BACK_PROMPT));
    m.start(40, at(6));
    assertEqual(m.phase, focus(run(40, at(46))));
});

test('with auto-start, a break that ends starts the next focus', () => {
    const m = machine(rest(runningRun(5, t0), 'water'));
    assertEqual(m.advance(at(5), 25), {kind: 'breakCompleted', autoStartedMinutes: 25});
    assertEqual(m.phase, focus(run(25, at(30))));
});

test('the next focus is the last one\'s length, by hand or by auto-start', () => {
    const m = machine();
    assertEqual(m.nextFocusMinutes(25), 25);
    m.start(35, t0);
    assertEqual(m.nextFocusMinutes(25), 35);
    m.takeBreak(5, 'water', at(35));
    m.advance(at(40), 50);
    assertEqual([m.lastFocusMinutes, m.nextFocusMinutes(25)], [50, 50]);
});

test('skip break by hand shows the back prompt, even with auto-start', () => {
    const m = machine(rest(runningRun(5, t0), 'water'));
    m.skipBreak();
    assertEqual(m.phase, prompt(BACK_PROMPT));
});

test('pause freezes the time left, and resume sets a new end', () => {
    const m = machine();
    m.start(25, t0);
    m.pause(at(10));
    assertEqual(m.phase, focus(run(25, null, 15 * 60_000)));
    assertEqual(m.nextDeadline, null);
    assertEqual(m.advance(at(60), null), null);
    m.resume(at(60));
    assertEqual(m.phase, focus(run(25, at(75))));
});

test('pause works in a break too', () => {
    const m = machine(rest(runningRun(10, t0), 'look'));
    m.pause(at(4));
    m.resume(at(20));
    assertEqual(m.phase, rest(run(10, at(26)), 'look'));
});

test('pausing twice or resuming a running timer changes nothing', () => {
    const m = machine();
    m.start(25, t0);
    m.resume(at(5));
    assertEqual(m.nextDeadline, at(25));
    m.pause(at(5));
    m.pause(at(9));
    assertEqual(m.phase, focus(run(25, null, 20 * 60_000)));
});

test('stop during a focus or a break goes idle and counts nothing', () => {
    let m = machine();
    m.start(25, t0);
    m.stop();
    assertEqual(m.phase, IDLE);
    m = machine(rest(runningRun(5, t0), 'water'));
    m.stop();
    assertEqual(m.phase, IDLE);
    m = machine(prompt(BACK_PROMPT));
    m.stop();
    assertEqual(m.phase, prompt(BACK_PROMPT));
});

test('take a break now, from any phase, is a manual prompt', () => {
    for (const phase of [IDLE, focus(runningRun(25, t0)), prompt(BACK_PROMPT), snoozed(at(5), BACK_PROMPT)]) {
        const m = machine(phase);
        m.takeBreakNow();
        assertEqual(m.phase, prompt(breakPrompt(true)), phase.kind);
    }
});

test('a snoozed prompt returns when its time is up', () => {
    const m = machine(prompt(breakPrompt(false)));
    m.snooze(5, t0);
    assertEqual(m.phase, snoozed(at(5), breakPrompt(false)));
    assertEqual(m.nextDeadline, at(5));
    assertEqual(m.advance(at(5), null), {kind: 'snoozeEnded', prompt: breakPrompt(false)});
    assertEqual(m.phase, prompt(breakPrompt(false)));
});

test('show now brings the snoozed prompt back', () => {
    const m = machine(prompt(BACK_PROMPT));
    m.snooze(2, t0);
    m.showNow();
    assertEqual(m.phase, prompt(BACK_PROMPT));
});

test('done ends the loop from either prompt', () => {
    for (const p of [breakPrompt(false), breakPrompt(true), BACK_PROMPT]) {
        const m = machine(prompt(p));
        m.doneForNow();
        assertEqual(m.phase, IDLE);
    }
});

test('done outside a prompt changes nothing', () => {
    for (const phase of [IDLE, focus(runningRun(25, t0)), rest(runningRun(5, t0), 'water'), snoozed(at(5), BACK_PROMPT)]) {
        const m = machine(phase);
        m.doneForNow();
        assertEqual(m.phase, phase);
    }
});

test('moves that don\'t apply change nothing', () => {
    const m = machine();
    m.startBreak('water', 5, t0);
    m.snooze(5, t0);
    m.showNow();
    m.skipBreak();
    m.pause(t0);
    assertEqual(m.phase, IDLE);
});

test('after a suspend, a focus that ended is counted on the day it ended', () => {
    const m = machine();
    m.start(25, t0);
    assertEqual(m.advance(at(180), null), {kind: 'focusCompleted', minutes: 25, endedAt: at(25)});
    assertEqual(m.phase, prompt(breakPrompt(false)));
    assertEqual(m.advance(at(181), null), null, 'one step only: the prompt waits for the user');
});

test('progress and time left follow the wall clock', () => {
    const r = runningRun(10, t0);
    assertEqual([timeLeft(r, at(4)), progress(r, at(5)), timeLeft(r, at(11)), progress(r, at(11))], [6 * 60_000, 0.5, 0, 1]);
});
