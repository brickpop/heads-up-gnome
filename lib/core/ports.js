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
 * Shell notifications (shell/notifier.js; ADR-002 §6.7), from one source, HeadsUp.
 * @typedef {object} Notifier
 * @property {(n: {id: string, category: string, title: string, body: string,
 *   actions: {id: string, label: string}[]}) => void} post  Replaces the one with the same id.
 * @property {(id: string) => void} withdraw  Nothing happens when none shows.
 * @property {(fn: (answer: {id: string, category: string, action: string | null}) => void) => Handle} onAction
 *   A button, or a click on the body (`action` null).
 */

/**
 * Session inhibitors (adapters/inhibitor.js; ADR-002 §6.5): org.gnome.SessionManager.
 * @typedef {object} Inhibitor
 * @property {(flags: number, reason: string) => Promise<Handle | null>} hold  Inhibit; null
 *   when GNOME refused. The handle's dispose() is Uninhibit.
 */

/**
 * The power source (adapters/upower.js), for "Only on power adapter".
 * @typedef {object} Power
 * @property {boolean} onBattery  false until UPower first answers
 * @property {(fn: () => void) => Handle} watch  onBattery changed
 */

/**
 * The user's activity (shell/idle.js: Mutter's idle monitor), for the services' keep-awake limit.
 * @typedef {object} Idle
 * @property {() => number} idleMs  since the last input
 * @property {(ms: number, fn: () => void) => Handle} onIdle  once, after `ms` without input
 * @property {(fn: () => void) => Handle} onActive  once, at the next input
 */

/**
 * A service run (adapters/processes.js; ADR-002 §6.4).
 * @typedef {object} Run
 * @property {number} pid
 * @property {string} unit  headsup-<id>-<run>.scope
 * @property {{whenReadable: (fn: () => void) => Handle, read: (max: number) => Promise<Uint8Array | null>}} output
 *   stdout and stderr: `whenReadable` calls fn once there is data or the end (dispose cancels
 *   the wait); `read` gives null at the end
 * @property {Promise<{code: number} | {signal: number}>} exited
 * @property {() => void} stop  stops the run's scope (systemd: SIGTERM, SIGKILL after 3 s)
 */

/**
 * Services' processes, each in its own systemd scope.
 * @typedef {object} Processes
 * @property {(spec: {id: string, command: string, cwd: string,
 *   env: {key: string, value: string}[], shell: string}) => Run} start  a new run name each time; throws on a broken rule (G10)
 * @property {() => Promise<number>} stopAll  stops every headsup-*.scope (N4b)
 * @property {() => {shell: string, fallback: string | null}} loginShell  from SHELL, checked with
 *   two stat calls (a regular, executable file)
 */

/**
 * @typedef {object} PortProbe
 * @property {(pid: number) => Promise<number | null>} listening  the port a process of pid's scope listens on
 * @property {(port: number) => Promise<boolean>} answers  a TCP connect to 127.0.0.1 works
 */

/**
 * @typedef {object} Files
 * @property {(path: string) => Promise<boolean>} isFolder  `~` is the home folder
 */

/**
 * @typedef {object} Links
 * @property {(uri: string) => void} open  with the user's default handler
 */

/**
 * The preferences window (the shell's `openPreferences()`).
 * @typedef {object} Preferences
 * @property {() => void} open
 */

/**
 * The only logger (adapters/log.js, G3): a fixed error code and fixed fields, never text
 * from the model, a tool, the clipboard, a service or a URL query.
 * @typedef {(code: string, fields?: Record<string, string | number | boolean>) => void} Log
 */

export {};
