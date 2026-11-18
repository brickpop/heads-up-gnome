// KeepAwake: the one owner of the session inhibitors (the Mac's PowerHolds; ADR-002 §6.5).
// Caffeine and each service say what they want kept awake; this holds one inhibitor per
// holder and kind, so no holder releases another's, and each shows by name in
// `gnome-session-inhibit --list`. It also owns "Only on power adapter" for all of them:
// while that option is on and the computer runs on battery, nothing is held.
//
// Holding is asynchronous (a D-Bus call): a hold is pending until GNOME answers, then held or
// refused. A refused hold isn't asked for again until its holder calls `set()` again.

import {Emitter} from './emitter.js';
import {Scope} from './scope.js';

/** The inhibit flags (org.gnome.SessionManager): idle keeps the display on, suspend the system. */
export const INHIBIT_FLAGS = Object.freeze({display: 8, system: 4});

const keyOf = (holder, kind) => `${holder}\n${kind}`;

export class KeepAwake extends Emitter {
    #inhibitor;
    #power;
    #store;
    #scope = new Scope();
    /** What each holder asked for: holder → {kinds, name}. */
    #wanted = new Map();
    /** The holds asked of GNOME: key → {holder, kind, name, handle (null while pending), released}. */
    #holds = new Map();
    /** Refused holds, by key, until their holder asks again. */
    #refused = new Set();
    #disposed = false;

    /**
     * @param {object} ports
     * @param {import('./ports.js').Inhibitor} ports.inhibitor
     * @param {import('./ports.js').Power} ports.power
     * @param {import('./settings.js').SettingsStore} ports.store
     */
    constructor({inhibitor, power, store}) {
        super();
        this.#inhibitor = inhibitor;
        this.#power = power;
        this.#store = store;
        this.#scope.add(power.watch(() => this.#apply()));
        this.#scope.add(store.on('changed', key => key === 'only-on-ac' && this.#apply()));
    }

    /** "Only on power adapter" is on and the computer runs on battery: nothing is held. */
    get pausedOnBattery() {
        return this.#store.state['only-on-ac'] === true && this.#power.onBattery === true;
    }

    /**
     * Holds `kinds` ('display', 'system') for `holder`, named `name`. An empty list releases
     * the holder. Asking again retries the holder's refused holds.
     */
    set(holder, kinds, name) {
        if (this.#disposed)
            return;
        const valid = [...new Set(kinds)].filter(kind => kind in INHIBIT_FLAGS);
        if (valid.length)
            this.#wanted.set(holder, {kinds: valid, name});
        else
            this.#wanted.delete(holder);
        for (const key of [...this.#refused]) {
            if (key.startsWith(`${holder}\n`))
                this.#refused.delete(key);
        }
        this.#apply();
    }

    /** What `holder` has now: the kinds held, still pending, and refused. */
    status(holder) {
        const status = {held: [], pending: [], refused: []};
        for (const hold of this.#holds.values()) {
            if (hold.holder === holder)
                (hold.handle ? status.held : status.pending).push(hold.kind);
        }
        for (const key of this.#refused) {
            const [h, kind] = key.split('\n');
            if (h === holder)
                status.refused.push(kind);
        }
        return status;
    }

    /** Releases every hold: turning HeadsUp off keeps nothing awake. */
    dispose() {
        this.#disposed = true;
        this.#scope.dispose();
        this.#wanted.clear();
        for (const key of [...this.#holds.keys()])
            this.#release(key);
    }

    /** Asks for what is wanted and not refused (nothing while paused), releases the rest. */
    #apply() {
        const paused = this.pausedOnBattery;
        const asked = new Map();
        if (!paused) {
            for (const [holder, {kinds, name}] of this.#wanted) {
                for (const kind of kinds) {
                    const key = keyOf(holder, kind);
                    if (!this.#refused.has(key))
                        asked.set(key, {holder, kind, name});
                }
            }
        }
        for (const [key, hold] of this.#holds) {
            if (asked.get(key)?.name !== hold.name)
                this.#release(key);
        }
        for (const [key, want] of asked) {
            if (!this.#holds.has(key))
                this.#request(key, want);
        }
        this.emit('changed');
    }

    #request(key, {holder, kind, name}) {
        const hold = {holder, kind, name, handle: null, released: false};
        this.#holds.set(key, hold);
        const answer = handle => {
            if (hold.released) {
                handle?.dispose();
                return;
            }
            if (handle) {
                hold.handle = handle;
            } else {
                this.#holds.delete(key);
                this.#refused.add(key);
            }
            this.emit('changed');
        };
        this.#inhibitor.hold(INHIBIT_FLAGS[kind], `HeadsUp: ${name}`).then(answer, () => answer(null));
    }

    #release(key) {
        const hold = this.#holds.get(key);
        this.#holds.delete(key);
        if (!hold)
            return;
        hold.released = true;
        hold.handle?.dispose();
    }
}
