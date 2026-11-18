// ADR-002 §5: dispose leaves zero live handles; the locked screen never shows the HUD (G2).
// Slice 0 has the settings, the wake shortcut and the HUD; each slice adds its features here.

import {test, assertEqual, testPorts} from '../harness.js';
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
    assertEqual(ports.hotkey.accels, ['<Super>space'], 'registered before dispose');

    app.dispose();
    assertEqual(liveHandles(ports), {});
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
