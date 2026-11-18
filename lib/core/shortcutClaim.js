// The wake shortcut and GNOME's layout switch (ADR-002 §6.3).
//
// GNOME's `switch-input-source` holds <Super>space, the default wake shortcut, and when two
// bindings share keys the window manager picks one at random. So HeadsUp takes the keys from
// that one setting, by the table in §6.3, or doesn't use them. `shortcutClaim()` is that
// table, pure. `ShortcutController` reads the ports, applies the result in one fixed order,
// and runs the table again whenever an input changes.

import {HUD_KEYS, normalizeAccel as normalize, validAccel} from './keys.js';
import {Scope} from './scope.js';

const SWITCH_SCHEMA = 'org.gnome.desktop.wm.keybindings';
const SWITCH_KEY = 'switch-input-source';
const NO_RECORD = Object.freeze({before: [], written: []});
const MAX_ROUNDS = 5;

const holdsAny = (accels, wanted) => {
    const keys = new Set(wanted.map(normalize));
    return accels.some(accel => keys.has(normalize(accel)));
};

const sameList = (a, b) =>
    a.length === b.length && a.every((accel, i) => normalize(accel) === normalize(b[i]));

const isSwitch = binding => binding.schema === SWITCH_SCHEMA && binding.key === SWITCH_KEY;

const validRecord = record =>
    Array.isArray(record?.before) && Array.isArray(record?.written) &&
    record.before.length > 0 && record.before.every(validAccel) && record.written.every(validAccel);

/**
 * The table of §6.3.
 *
 * @param {object} input
 * @param {string[]} input.wanted  `hud-shortcut`
 * @param {import('./ports.js').Binding[]} input.bindings  GNOME's, switch-input-source included
 * @param {number} input.sourceCount  keyboard layouts and input methods
 * @param {boolean} input.consent  `take-input-source-key`
 * @param {'none' | 'taken' | 'returned'} input.claim  `input-source-claim`
 * @param {{before: string[], written: string[]}} input.record  `input-source-binding`
 * @returns {{
 *   status: 'ok' | 'layouts' | 'in-use' | 'failed',
 *   holder: string,
 *   register: boolean,
 *   claim: 'none' | 'taken' | 'returned',
 *   record: {before: string[], written: string[]},
 *   consent: boolean | undefined,
 *   switchInputSource: string[] | undefined,
 *   layoutNotice: boolean,
 *   problem: string | undefined,
 * }} what to write: `consent` and `switchInputSource` are undefined when unchanged;
 *   `layoutNotice` is true when a second layout made HeadsUp give the keys back.
 */
export function shortcutClaim(input) {
    const {wanted, bindings, sourceCount} = input;
    const current = bindings.find(isSwitch)?.accels ?? [];
    let {claim, record} = input;
    let switchNow = current;
    let consent;
    let layoutNotice = false;
    let problem;

    const done = (status, holder = '', register = false) => ({
        status, holder, register, claim, record, consent, layoutNotice, problem,
        switchInputSource: sameList(switchNow, current) ? undefined : switchNow,
    });

    if (claim === 'taken') {
        if (!validRecord(record)) {
            // Damaged (G8b): nothing of it is ever written back.
            problem = 'shortcut.record-damaged';
            claim = 'none';
            record = NO_RECORD;
        } else if (!sameList(current, record.written)) {
            // The user changed layout switching since HeadsUp wrote it: their value stays.
            record = NO_RECORD;
            if (holdsAny(current, wanted)) {
                claim = 'returned';
                consent = false;
                return done('layouts');
            }
            claim = 'none';
        } else {
            const taken = record.before.filter(accel => !holdsAny([accel], record.written));
            const secondLayout = sourceCount >= 2 && !input.consent;
            if (secondLayout || !taken.every(accel => holdsAny([accel], wanted))) {
                // Give back: the keys HeadsUp took aren't wanted any more, or a second
                // layout needs them and the user didn't agree.
                switchNow = record.before;
                claim = 'none';
                record = NO_RECORD;
                layoutNotice = secondLayout;
            }
        }
    }

    if (wanted.length === 0 || !wanted.every(validAccel))
        return done('failed');

    const holder = bindings.find(b => !isSwitch(b) && holdsAny(b.accels, wanted));
    if (holder) {
        // Returned keys no longer wanted: nothing is left to remember (Rev 33, 14).
        if (claim === 'returned')
            claim = 'none';
        return done('in-use', holder.name || holder.key);
    }

    if (!holdsAny(switchNow, wanted)) {
        // Returned keys no longer wanted: nothing is left to remember (Rev 33).
        if (claim === 'returned')
            claim = 'none';
        return done('ok', '', true);
    }

    const mayTake = claim === 'returned' ? input.consent : sourceCount < 2 || input.consent;
    if (!mayTake)
        return done('layouts');
    if (!switchNow.every(validAccel)) {
        problem = 'shortcut.switch-unreadable';
        return done('layouts');
    }
    const written = switchNow.filter(accel => !holdsAny([accel], wanted));
    record = {before: claim === 'taken' ? record.before : switchNow, written};
    claim = 'taken';
    switchNow = written;
    return done('ok', '', true);
}

/**
 * Why the prefs recorder can't save these keys, or null (UX §7, the Mac's keysProblem):
 * - `invalid`: not an accelerator HeadsUp accepts;
 * - `needs-modifier`: no Ctrl, Alt or Super, unless a function key (a plain key would fire
 *   while typing);
 * - `used-by-headsup`: a key the HUD itself uses (HUD_KEYS in keys.js);
 * - `in-use`: a GNOME action holds them, with its name. switch-input-source doesn't count:
 *   the table of §6.3 handles it.
 * @param {string} accel
 * @param {import('./ports.js').Binding[]} bindings  GnomeKeys.bindings()
 */
export function recorderProblem(accel, bindings) {
    if (!validAccel(accel))
        return {kind: 'invalid'};
    const [mods, key] = [normalize(accel).split('+').slice(0, -1), normalize(accel).split('+').at(-1)];
    const hasModifier = mods.some(mod => ['control', 'alt', 'super'].includes(mod));
    if (!hasModifier && !/^f[0-9]+$/.test(key))
        return {kind: 'needs-modifier'};
    if (holdsAny(HUD_KEYS.map(k => k.accel), [accel]))
        return {kind: 'used-by-headsup'};
    const holder = bindings.find(b => !isSwitch(b) && holdsAny(b.accels, [accel]));
    return holder ? {kind: 'in-use', holder: holder.name || holder.key} : null;
}

/**
 * Giving the keys back at `disable()`: only while switch-input-source still holds what
 * HeadsUp wrote (G8a). Same shape as `shortcutClaim()`'s result.
 */
export function shortcutRelease({bindings, claim, record}) {
    const current = bindings.find(isSwitch)?.accels ?? [];
    const giveBack = claim === 'taken' && validRecord(record) && sameList(current, record.written);
    return {
        status: 'off', holder: '', register: false,
        claim: claim === 'taken' ? 'none' : claim,
        record: NO_RECORD,
        consent: undefined,
        switchInputSource: giveBack ? record.before : undefined,
        layoutNotice: false,
        problem: undefined,
    };
}

/**
 * Runs the table at start and whenever its inputs change, and owns the wake shortcut's
 * registration. Writes in one fixed order, so its own writes never look like the user's
 * (Scan N3): the claim and record, then the consent, then switch-input-source, then the
 * registration and the status. A change seen while it writes runs the table again after.
 */
export class ShortcutController {
    #store;
    #keys;
    #hotkey;
    #session;
    #log;
    #onActivate;
    #scope = new Scope();
    #registered = null;
    #running = false;
    #again = false;
    #consentWithdrawn = false;

    /**
     * @param {object} ports
     * @param {import('./settings.js').SettingsStore} ports.store
     * @param {import('./ports.js').GnomeKeys} ports.gnomeKeys
     * @param {import('./ports.js').Hotkey} ports.hotkey
     * @param {import('./ports.js').Session} ports.session
     * @param {import('./ports.js').Log} ports.log
     * @param {() => void} onActivate  the shortcut was pressed
     */
    constructor({store, gnomeKeys, hotkey, session, log}, onActivate) {
        this.#store = store;
        this.#keys = gnomeKeys;
        this.#hotkey = hotkey;
        this.#session = session;
        this.#log = log;
        this.#onActivate = onActivate;
        const inputs = new Set(['hud-shortcut', 'take-input-source-key', 'input-source-claim', 'input-source-binding']);
        this.#scope.add(store.on('changed', key => {
            if (key === 'take-input-source-key' && !store.state[key])
                this.#consentWithdrawn = true;
            if (inputs.has(key))
                this.run();
        }));
        this.#scope.add(gnomeKeys.watch(() => this.run()));
        // Lock: only unregister; no table run and no write. Unlock: the table runs again.
        this.#scope.add(session.watch(locked => (locked ? this.#unregister() : this.run())));
        this.run();
    }

    run() {
        if (this.#running) {
            this.#again = true;
            return;
        }
        this.#running = true;
        try {
            // Our own writes run it once more and change nothing (N3). A run that keeps
            // changing is a bug or a fight with another program: stop and say so.
            let rounds = 0;
            do {
                this.#again = false;
                if (++rounds > MAX_ROUNDS) {
                    this.#log('shortcut.loop');
                    break;
                }
                this.#apply(shortcutClaim(this.#input()));
            } while (this.#again);
        } finally {
            this.#running = false;
        }
    }

    /** Gives the keys back and unregisters; nothing runs after. */
    dispose() {
        this.#scope.dispose();
        this.#running = true;
        this.#apply(shortcutRelease(this.#input()));
    }

    #unregister() {
        if (this.#registered)
            this.#hotkey.unregister();
        this.#registered = null;
        if (this.#store.state['hud-shortcut-active'].length)
            this.#store.set('hud-shortcut-active', []);
    }

    #input() {
        const s = this.#store.state;
        const [before, written] = s['input-source-binding'];
        return {
            wanted: s['hud-shortcut'],
            bindings: this.#keys.bindings(),
            sourceCount: this.#keys.inputSourceCount(),
            consent: s['take-input-source-key'],
            claim: s['input-source-claim'],
            record: {before, written},
        };
    }

    #apply(result) {
        const store = this.#store;
        const write = (key, value) => {
            if (JSON.stringify(store.state[key]) !== JSON.stringify(value))
                store.set(key, value);
        };
        if (result.problem)
            this.#log(result.problem);
        write('input-source-claim', result.claim);
        write('input-source-binding', [result.record.before, result.record.written]);
        // The notice is for a layout added later, not for the user's own "Give back".
        if (result.layoutNotice && !this.#consentWithdrawn)
            write('layout-notice', true);
        this.#consentWithdrawn = false;
        if (result.consent !== undefined)
            write('take-input-source-key', result.consent);
        if (result.switchInputSource)
            this.#keys.setSwitchInputSource(result.switchInputSource);

        let status = result.status;
        const accels = result.register && !this.#session.locked ? store.state['hud-shortcut'] : null;
        if (JSON.stringify(accels) !== JSON.stringify(this.#registered)) {
            this.#unregister();
            if (accels) {
                // hud-shortcut-active names the keys in force: only keys the table accepted.
                write('hud-shortcut-active', accels);
                if (this.#hotkey.register(accels, this.#onActivate) === 'ok')
                    this.#registered = accels;
                else
                    write('hud-shortcut-active', []);
            }
        }
        if (accels && !this.#registered)
            status = 'failed';
        // While locked nothing is registered, which says nothing about the shortcut: the
        // status waits for the run at unlock. `off` at disable() is written even then.
        if (this.#session.locked && status !== 'off')
            return;
        write('hud-shortcut-status', status);
        write('hud-shortcut-holder', result.holder);
    }
}
