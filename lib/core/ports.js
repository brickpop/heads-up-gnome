// The ports the core is built from (ADR-002 §4): what each adapter provides, and each fake
// in test/fakes.js. Types only. Every subscription returns a Handle. Ports arrive slice by slice.

/**
 * @typedef {object} Handle
 * @property {() => void} dispose  Ends the subscription, timer or registration.
 */

/**
 * @typedef {object} Clock
 * @property {() => Date} now
 * @property {() => '24h' | '12h'} timeFormat  GNOME's clock format.
 */

/**
 * Wall-clock timers. Re-arms every timer on resume from suspend and when the wall clock
 * jumps, so a timer fires at its date, not after a monotonic delay (ADR-002 §6.2).
 * @typedef {object} Scheduler
 * @property {(date: Date, fn: () => void) => Handle} at  Calls fn once at date (at once if past).
 * @property {(ms: number, fn: () => void) => Handle} every  Calls fn every ms.
 */

/**
 * One GSettings schema: `State` (written by the shell). Values are plain JS: booleans,
 * numbers, strings, arrays; a tuple is an array. Only SettingsStore uses these ports.
 * @typedef {object} KeyValues
 * @property {() => string[]} keys  The schema's keys: the schema is the one source of keys
 *   and defaults.
 * @property {(key: string) => any} get
 * @property {(key: string, value: any) => void} set  Throws on an unknown key or a bad value.
 * @property {(fn: (key: string) => void) => Handle} watch  Any key changed, by anyone.
 */

/**
 * The user's choices (`Settings`): a `KeyValues` that can also go back to defaults.
 * @typedef {KeyValues & {reset: (key: string) => void}} Settings
 */

/**
 * A GNOME keybinding, from the schemas listed in ADR-002 §6.3.
 * @typedef {object} Binding
 * @property {string} schema  e.g. "org.gnome.desktop.wm.keybindings"
 * @property {string} key  e.g. "switch-input-source"
 * @property {string} name  What the user knows it as, e.g. "Switch to next input source".
 * @property {string[]} accels
 */

/**
 * GNOME's keybindings and input sources. The one GNOME setting HeadsUp ever writes is
 * `org.gnome.desktop.wm.keybindings switch-input-source` (G8b), fixed in the adapter.
 * @typedef {object} GnomeKeys
 * @property {() => Binding[]} bindings  Includes switch-input-source.
 * @property {() => number} inputSourceCount  Entries in `org.gnome.desktop.input-sources sources`.
 * @property {(accels: string[]) => void} setSwitchInputSource
 * @property {(fn: () => void) => Handle} watch  Any binding or the sources changed.
 */

/**
 * The wake shortcut's registration with the window manager (shell/keybinding.js).
 * Only ShortcutController calls it.
 * @typedef {object} Hotkey
 * @property {(accels: string[], onActivate: () => void) => 'ok' | 'failed'} register
 * @property {() => void} unregister  Nothing happens when none is registered.
 */

/**
 * The screen lock (shell/session.js).
 * @typedef {object} Session
 * @property {boolean} locked  True in `unlock-dialog` or any mode other than `user`.
 * @property {(fn: (locked: boolean) => void) => Handle} watch
 */

/**
 * The HUD actor (shell/hud.js). `show()` and `focus()` do nothing while locked (G2).
 * It calls `HudStore.didResignKey()` when it loses the grab it didn't drop itself (§4 item 6).
 * @typedef {object} Hud
 * @property {() => void} show  Shown with no grab; drops the grab when it holds one.
 * @property {() => boolean} focus  Shown, with the grab; false when the shell refused the grab
 *   (the HUD is then shown without it).
 * @property {() => void} hide
 * @property {Date | null} focusedSince  When the grab was taken; null when not focused.
 */

/**
 * The only logger (adapters/log.js, G3): a fixed error code and fixed fields, never text
 * from the model, a tool, the clipboard, a service or a URL query.
 * @typedef {(code: string, fields?: Record<string, string | number | boolean>) => void} Log
 */

export {};
