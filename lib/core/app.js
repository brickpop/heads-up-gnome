// Builds the stores from the ports, for `enable()` in the shell (ADR-002 §4). `dispose()`
// undoes everything, for `disable()`.

import {HudStore} from './hud.js';
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
    const hud = own(new HudStore({...ports, store: settings}));
    const shortcut = own(new ShortcutController({...ports, store: settings}, () => hud.hotkeyPressed()));
    // The welcome opens once, on the first enable (UX §7); while locked it waits.
    if (!settings.state['welcome-done'])
        hud.autoOpen();
    return {settings, hud, shortcut, dispose: () => scope.dispose()};
}
