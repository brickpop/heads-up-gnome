// The Session port (ADR-002 §4, §6.1): whether the screen is locked.
//
// Locked means the lock screen or the unlock prompt is up, or the shell runs in any mode
// other than the user's session. The HUD adapter asks it before every show and focus.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const readLocked = () => Main.sessionMode.isLocked || Main.sessionMode.currentMode !== 'user';

export class Session {
    #watchers = new Set();
    #locked = readLocked();
    #signal;

    constructor() {
        this.#signal = Main.sessionMode.connect('updated', () => {
            const locked = readLocked();
            if (locked === this.#locked)
                return;
            this.#locked = locked;
            for (const fn of [...this.#watchers])
                fn(locked);
        });
    }

    /** @returns {boolean} */
    get locked() {
        return this.#locked;
    }

    /**
     * @param {(locked: boolean) => void} fn called when the lock state changes
     * @returns {{dispose(): void}}
     */
    watch(fn) {
        this.#watchers.add(fn);
        return {dispose: () => this.#watchers.delete(fn)};
    }

    dispose() {
        Main.sessionMode.disconnect(this.#signal);
        this.#watchers.clear();
    }
}
