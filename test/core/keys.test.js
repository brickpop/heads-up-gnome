// The HUD's keys: one test per HUD_KEYS command, the prompt-empty rule, the Esc cascade,
// and the recorder refusing every one of them (Nick, slice 1).

import {test, assertEqual, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {HUD_KEYS} from '../../lib/core/keys.js';
import {recorderProblem} from '../../lib/core/shortcutClaim.js';

const start = () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp(ports);
    app.hud.focus('chat');
    return {ports, app};
};
const ctrl = key => ({key, ctrl: true});

test('Ctrl+1–5 pick a tab; Ctrl+Page Down and Up step through them, wrapping', () => {
    const {app} = start();
    const tabs = ['1', '2', '3', '4', '5'].map(key => (app.handleKey(ctrl(key), true), app.hud.state.tab));
    assertEqual(tabs, ['chat', 'focus', 'caffeine', 'services', 'commands']);
    assertEqual(app.handleKey(ctrl('Page_Down'), false), true);
    assertEqual(app.hud.state.tab, 'chat');
    app.handleKey(ctrl('Page_Up'), false);
    assertEqual(app.hud.state.tab, 'commands');
    app.dispose();
});

test('Ctrl+Enter and Ctrl+keypad Enter run the Focus primary action, on Focus only', () => {
    const {app} = start();
    assertEqual(app.handleKey(ctrl('Return'), true), false, 'not on Focus');
    app.hud.selectTab('focus');
    assertEqual([app.handleKey(ctrl('Return'), true), app.focus.phase.kind], [true, 'focus']);
    app.focus.stop();
    assertEqual([app.handleKey(ctrl('KP_Enter'), false), app.focus.phase.kind], [true, 'focus']);
    assertEqual(app.handleKey(ctrl('Return'), true), false, 'a running focus has no primary button');
    app.dispose();
});

test('Ctrl+, opens Preferences and closes the HUD', () => {
    const {ports, app} = start();
    assertEqual([app.handleKey(ctrl('comma'), false), ports.preferences.opened, app.hud.state.visible], [true, 1, false]);
    app.dispose();
});

test('Ctrl+N, Ctrl+P and Ctrl+. are the chat\'s, not handled before slice 5', () => {
    const {app} = start();
    assertEqual(['n', 'p', 'period'].map(key => app.handleKey(ctrl(key), true)), [false, false, false]);
    app.dispose();
});

test('Alt+arrows move the Focus cards, only with an empty prompt', () => {
    const {app} = start();
    app.hud.selectTab('focus');
    assertEqual(app.handleKey({key: 'Right', alt: true}, false), false, 'text in the prompt: the field moves by word');
    assertEqual([app.handleKey({key: 'Right', alt: true}, true), app.focus.focusLength], [true, 40]);
    assertEqual([app.handleKey({key: 'Left', alt: true}, true), app.focus.focusLength], [true, 25]);
    app.dispose();
});

test('Alt+Shift+arrows move the snooze length on a prompt', () => {
    const {app} = start();
    app.hud.selectTab('focus');
    app.focus.takeBreakNow();
    assertEqual([app.handleKey({key: 'Right', alt: true, shift: true}, true), app.focus.selectedSnoozeMinutes], [true, 10]);
    assertEqual([app.handleKey({key: 'Left', alt: true, shift: true}, true), app.focus.selectedSnoozeMinutes], [true, 5]);
    app.dispose();
});

test('every HUD_KEYS command is handled somewhere above, and other keys are not', () => {
    const commands = new Set(HUD_KEYS.map(k => k.command.split(':')[0]));
    assertEqual([...commands].sort(), ['card', 'newChat', 'pin', 'preferences', 'primary', 'select', 'snooze', 'stop', 'tab']);
    const {app} = start();
    assertEqual([app.handleKey({key: 'a'}, true), app.handleKey(ctrl('q'), true), app.handleKey({key: 'Right'}, true)], [false, false, false]);
    app.dispose();
});

test('Esc: clears the prompt first, then snoozes a Focus prompt, then hides', () => {
    const {app} = start();
    app.hud.selectTab('focus');
    app.focus.takeBreakNow();
    app.hud.setInput('foc');
    app.escape();
    assertEqual([app.hud.state.input, app.focus.phase.kind, app.hud.state.visible], ['', 'prompt', true]);
    app.escape();
    assertEqual(app.focus.phase.kind, 'snoozed');
    app.escape();
    assertEqual(app.hud.state.visible, false);
    app.dispose();
});

test('the recorder refuses every HUD key', () => {
    for (const {accel} of HUD_KEYS)
        assertEqual(recorderProblem(accel, []) !== null, true, accel);
    assertEqual(recorderProblem('<Control>Page_Up', []), {kind: 'used-by-headsup'});
});

test('↑ ↓ move through the suggestions while there are any, else they stay the field\'s', () => {
    const {app} = start();
    assertEqual(app.handleKey({key: 'Down'}, true), false);
    app.hud.setInput('focus');
    assertEqual([app.handleKey({key: 'Down'}, false), app.hud.state.selected], [true, 1]);
    assertEqual([app.handleKey({key: 'Up'}, false), app.hud.state.selected], [true, 0]);
    app.dispose();
});

test('app.now() is the clock the stores use', () => {
    const {ports, app} = start();
    ports.clock.advance(5000);
    assertEqual(app.now(), ports.clock.now().getTime());
    app.dispose();
});

test('the footer: a toast, else the hints for what shows', () => {
    const {ports, app} = start();
    assertEqual(app.footer().hints.map(h => h.label), ['tabs', 'actions', 'close']);
    app.hud.selectTab('focus');
    assertEqual(app.footer().hints.map(h => h.label), ['choose', 'start', 'close']);
    app.focus.takeBreakNow();
    assertEqual(app.footer().hints.map(h => h.label), ['choose', 'snooze length', 'snooze']);
    app.focus.startBreak();
    assertEqual(app.footer().toast.text, 'Break started · 5 min');
    ports.clock.advance(2600);
    assertEqual(app.footer().hints.map(h => h.label), ['tabs', 'actions', 'close'], 'a running break has no cards');
    app.hud.setInput('focus');
    assertEqual(app.footer().hints.map(h => h.label), ['navigate', 'run', 'clear']);
    app.hud.setInput('/fcous');
    assertEqual(app.footer().hints.map(h => h.label), ['clear']);
    app.hud.setInput('hello there');
    assertEqual(app.footer().hints.map(h => h.label), ['switch', 'actions', 'close']);
    app.hud.toast('Saved');
    assertEqual(app.footer(), {toast: {text: 'Saved', seq: 2}});
    app.dispose();
});

test('Preferences open on a named page (prefs-page), or the last one; unknown pages are ignored', () => {
    const {ports, app} = start();
    app.openPreferences('services');
    assertEqual([ports.state.get('prefs-page'), ports.preferences.opened, app.hud.state.visible], ['services', 1, false]);
    ports.state.set('prefs-page', '');
    app.openPreferences('nowhere');
    app.handleKey({key: 'comma', ctrl: true}, true);
    assertEqual([ports.state.get('prefs-page'), ports.preferences.opened], ['', 3]);
    app.dispose();
});
