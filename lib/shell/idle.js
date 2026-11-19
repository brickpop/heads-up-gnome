// The Idle port (ADR-002 §4, §6.5): the user's last activity, from Mutter's idle monitor, for
// the services' keep-awake limit. No polling: Mutter calls back when the time comes. Remote
// input counts as activity.

export class Idle {
    #monitor = global.backend.get_core_idle_monitor();
    #watches = new Set();

    /** @returns {number} ms since the last input */
    idleMs() {
        return this.#monitor.get_idletime();
    }

    /**
     * Calls `fn` once, after `ms` without input.
     *
     * @param {number} ms
     * @param {() => void} fn
     * @returns {{dispose(): void}}
     */
    onIdle(ms, fn) {
        return this.#watch(handle => this.#monitor.add_idle_watch(ms, () => {
            handle.dispose();
            fn();
        }));
    }

    /**
     * Calls `fn` once, at the next input.
     *
     * @param {() => void} fn
     * @returns {{dispose(): void}}
     */
    onActive(fn) {
        return this.#watch(handle => this.#monitor.add_user_active_watch(() => {
            // Mutter removes a user-active watch once it fires.
            handle.fired = true;
            handle.dispose();
            fn();
        }));
    }

    /** Every watch still set is removed. */
    dispose() {
        for (const handle of [...this.#watches])
            handle.dispose();
    }

    #watch(add) {
        const handle = {
            id: 0,
            fired: false,
            dispose: () => {
                if (!this.#watches.delete(handle))
                    return;
                if (!handle.fired)
                    this.#monitor.remove_watch(handle.id);
            },
        };
        this.#watches.add(handle);
        handle.id = add(handle);
        return handle;
    }
}
