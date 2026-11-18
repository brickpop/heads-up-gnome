// The Hotkey port (ADR-002 §4, §6.3): the wake shortcut, registered with Mutter. The core's
// ShortcutController is its only caller: it decides when to register, and unregisters on lock.
//
// Mutter reads the keys from a settings key itself and re-binds whenever it changes. So it
// binds the state key `hud-shortcut-active`, which only the controller writes, just before it
// calls `register` (Scan P0-1). `hud-shortcut` is the user's wish; this key is what is bound,
// and any program changing `hud-shortcut` can't get keys bound before the §6.3 table runs.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const KEY = 'hud-shortcut-active';

// Where the shortcut works: in apps, in the overview, and while a shell popup (or the HUD,
// which holds a POPUP grab) is open. Never on the lock or login screen.
const MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP;

export class Hotkey {
    #settings;
    #registered = false;

    /** @param {import('gi://Gio').default.Settings} state the extension's state settings */
    constructor(state) {
        this.#settings = state;
    }

    /**
     * @param {string[]} _accels the value of `hud-shortcut-active`; Mutter reads it from there
     * @param {() => void} onActivate called on each press
     * @returns {'ok' | 'failed'} `failed` when Mutter refuses the keys
     */
    register(_accels, onActivate) {
        this.unregister();
        // Mutter aborts the whole shell on a key its schema lacks (an old schema left installed).
        if (!this.#settings.settings_schema.has_key(KEY))
            return 'failed';
        const action = Main.wm.addKeybinding(
            KEY, this.#settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, MODES, () => onActivate());
        if (action === Meta.KeyBindingAction.NONE)
            return 'failed';
        this.#registered = true;
        return 'ok';
    }

    unregister() {
        if (!this.#registered)
            return;
        Main.wm.removeKeybinding(KEY);
        this.#registered = false;
    }
}
