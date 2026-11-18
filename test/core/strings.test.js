import {test, assertEqual} from '../harness.js';
import {accelLabel, General, Indicator, Recorder, Shortcut, Tabs, Welcome} from '../../lib/core/strings.js';
import {TABS} from '../../lib/core/hud.js';

test('accelLabel writes keys as GNOME Settings does', () => {
    const cases = [
        ['<Super>space', 'Super+Space'], ['<Shift><Super>space', 'Shift+Super+Space'],
        ['<Primary>comma', 'Ctrl+,'], ['<Control><Alt>t', 'Ctrl+Alt+T'], ['<Control>Page_Up', 'Ctrl+Page Up'],
        ['F12', 'F12'], ['<Alt>Return', 'Alt+Enter'], ['XF86Keyboard', 'XF86Keyboard'],
    ];
    for (const [accel, label] of cases)
        assertEqual(accelLabel(accel), label, accel);
    for (const none of ['', undefined, '<Super>', 'a b'])
        assertEqual(accelLabel(none), '', String(none));
});

test('indicator: the accessible name joins the parts after the app name', () => {
    assertEqual(Indicator.accessibleName([Indicator.idle]), 'HeadsUp, Idle');
});

test('tabs: a title and "Title · Ctrl+n" for each of the five', () => {
    assertEqual(TABS.map(Tabs.tooltip), ['Chat · Ctrl+1', 'Focus · Ctrl+2', 'Caffeine · Ctrl+3', 'Services · Ctrl+4', 'Commands · Ctrl+5']);
});

test('welcome line by status', () => {
    assertEqual(Welcome.line('ok', 'Super+Space'), 'Press Super+Space in any app to open this.');
    assertEqual(Welcome.line('layouts', 'Super+Space'), 'Super+Space switches your keyboard layout. You can let HeadsUp use it in Preferences.');
    assertEqual(Welcome.line('in-use', 'Super+Space'), "Super+Space isn't working. Choose a shortcut in Preferences.");
    assertEqual(Welcome.line('failed', 'Alt+H'), "Alt+H isn't working. Choose a shortcut in Preferences.");
    assertEqual(Welcome.line('failed', ''), "Your shortcut isn't working. Choose a shortcut in Preferences.");
    assertEqual(['ok', 'layouts', 'in-use', 'failed'].map(Welcome.needsPreferences), [false, true, true, true]);
});

test('Wake Shortcut notes by status (UX §7 table)', () => {
    assertEqual(Shortcut.note('ok', '', 'Super+Space'), null);
    assertEqual(Shortcut.note('off', '', 'Super+Space'), null);
    assertEqual(Shortcut.note('layouts', '', 'Super+Space'), "Super+Space switches your keyboard layout, so HeadsUp can't use it.");
    assertEqual(Shortcut.note('in-use', 'Show the overview', 'Super+Space'), 'GNOME uses Super+Space for Show the overview. Choose another shortcut.');
    assertEqual(Shortcut.note('failed', '', 'Super+Space'), "This shortcut couldn't be set up. Choose another one.");
});

test('recorder lines and the click-elsewhere subtitle', () => {
    assertEqual(Recorder.problem({kind: 'in-use', holder: 'Close window'}, 'Alt+F4'), 'GNOME uses Alt+F4 for Close window. Choose another shortcut.');
    assertEqual(Recorder.problem({kind: 'needs-modifier'}, 'A'), 'Use it with Ctrl, Alt or Super.');
    assertEqual(General.closeOnClickOutsideSubtitle('Super+Space'), 'Off: it stays open until you press Esc or Super+Space');
    assertEqual(General.closeOnClickOutsideSubtitle(null), 'Off: it stays open until you press Esc');
});
