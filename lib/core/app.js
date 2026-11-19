// Builds the stores from the ports, for `enable()` in the shell (ADR-002 §4). `dispose()`
// undoes everything, for `disable()`.

import {ActionRegistry, caffeineActions, focusActions, goToActions, quickTimerAction, serviceActions} from './actions.js';
import {CaffeineStore} from './caffeine.js';
import {FocusStore} from './focus.js';
import {HudStore, tabActivity} from './hud.js';
import {IndicatorModel} from './indicatorModel.js';
import {KeepAwake} from './keepAwake.js';
import {menu} from './menuModel.js';
import {escape, footer, handleKey, openPreferences} from './keys.js';
import {Scope} from './scope.js';
import {SettingsStore} from './settings.js';
import {ServiceStore} from './services.js';
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
    const services = own(new ServiceStore({...ports, store: settings, keepAwake, hudStore: hud}));
    const caffeine = own(new CaffeineStore({...ports, store: settings, keepAwake, hudStore: hud, serviceHolds: () => services.serviceHolds}));
    const indicator = own(new IndicatorModel({...ports, focus, caffeine, services, hudStore: hud, store: settings}));
    const shortcut = own(new ShortcutController({...ports, store: settings}, () => hud.hotkeyPressed()));
    actions.add('focus', () => focusActions(focus, hud));
    actions.add('caffeine', () => caffeineActions(caffeine));
    actions.add('service', () => serviceActions(services));
    actions.add('view', () => goToActions(hud));
    actions.setQuickTimer((kind, minutes) => quickTimerAction(kind, minutes, {focus, hud, clock: ports.clock}));
    // The welcome opens once, on the first enable (UX §7); while locked it waits.
    if (!settings.state['welcome-done'])
        hud.autoOpen();
    // HeadsUp scopes left behind stop, then the autostart services start (N4b).
    services.enable();
    const stores = {settings, hud, focus, caffeine, services, preferences: ports.preferences};
    return {
        settings, hud, focus, keepAwake, caffeine, services, indicator, shortcut, actions,
        /** A key pressed in the HUD; true when handled (keys.js). */
        handleKey: (event, promptEmpty) => handleKey(stores, event, promptEmpty),
        /** Preferences, on `page` ('general', 'focus', 'services') or the last one (keys.js). */
        openPreferences: (page = null) => openPreferences(stores, page),
        /** Esc in the HUD (keys.js). */
        escape: () => escape(stores),
        /** The panel menu at `now` (ms), from every store (menuModel.js). */
        menu: now => menu(stores, now),
        /** The footer's left side: a toast or the hints (keys.js). */
        footer: () => footer(stores),
        /** Now, in ms: the views' one source of time, so tests drive them with the fake clock. */
        now: () => ports.clock.now().getTime(),
        /** The dots on the inactive tabs (hud.js). */
        tabActivity: () => tabActivity(stores),
        dispose: () => scope.dispose(),
    };
}
