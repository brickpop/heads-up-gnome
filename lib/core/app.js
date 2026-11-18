// Builds the stores from the ports, for `enable()` in the shell (ADR-002 §4). `dispose()`
// undoes everything, for `disable()`.

import {ActionRegistry, caffeineActions, focusActions, goToActions, quickTimerAction} from './actions.js';
import {CaffeineStore} from './caffeine.js';
import {FocusStore} from './focus.js';
import {HudStore, tabActivity} from './hud.js';
import {IndicatorModel} from './indicatorModel.js';
import {KeepAwake} from './keepAwake.js';
import {escape, footer, handleKey} from './keys.js';
import {Scope} from './scope.js';
import {SettingsStore} from './settings.js';
import {ShortcutController} from './shortcutClaim.js';

/**
 * @param {object} ports  see ports.js; the shell passes its adapters, tests pass test/fakes.js
 */
export function createApp(ports) {
    const scope = new Scope();
    const own = store => {
        scope.add(store);
        return store;
    };
    // Disposed newest first: the shortcut gives the keys back while the settings still work.
    const settings = own(new SettingsStore(ports));
    const actions = new ActionRegistry();
    const hud = own(new HudStore({...ports, store: settings, actions}));
    const focus = own(new FocusStore({...ports, store: settings, hudStore: hud}));
    const keepAwake = own(new KeepAwake({...ports, store: settings}));
    const caffeine = own(new CaffeineStore({...ports, store: settings, keepAwake, hudStore: hud}));
    const indicator = own(new IndicatorModel({...ports, focus, caffeine, hudStore: hud, store: settings}));
    const shortcut = own(new ShortcutController({...ports, store: settings}, () => hud.hotkeyPressed()));
    actions.add('focus', () => focusActions(focus, hud));
    actions.add('caffeine', () => caffeineActions(caffeine));
    actions.add('view', () => goToActions(hud));
    actions.setQuickTimer((kind, minutes) => quickTimerAction(kind, minutes, {focus, hud, clock: ports.clock}));
    // The welcome opens once, on the first enable (UX §7); while locked it waits.
    if (!settings.state['welcome-done'])
        hud.autoOpen();
    const stores = {hud, focus, caffeine, preferences: ports.preferences};
    return {
        settings, hud, focus, keepAwake, caffeine, indicator, shortcut, actions,
        /** A key pressed in the HUD; true when handled (keys.js). */
        handleKey: (event, promptEmpty) => handleKey(stores, event, promptEmpty),
        /** Esc in the HUD (keys.js). */
        escape: () => escape(stores),
        /** The footer's left side: a toast or the hints (keys.js). */
        footer: () => footer(stores),
        /** Now, in ms: the views' one source of time, so tests drive them with the fake clock. */
        now: () => ports.clock.now().getTime(),
        /** The dots on the inactive tabs (hud.js). */
        tabActivity: () => tabActivity(stores),
        dispose: () => scope.dispose(),
    };
}
