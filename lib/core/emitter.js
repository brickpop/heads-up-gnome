// The `changed` event of every store (ADR-002 §4): listeners are called in the order they
// were added; each `on()` returns a handle whose `dispose()` removes that listener.

export class Emitter {
    #listeners = new Map();

    /** @returns {{dispose(): void}} */
    on(event, fn) {
        const set = this.#listeners.get(event) ?? new Set();
        this.#listeners.set(event, set);
        const entry = {fn};
        set.add(entry);
        return {dispose: () => set.delete(entry)};
    }

    emit(event, ...args) {
        for (const entry of [...this.#listeners.get(event) ?? []])
            entry.fn(...args);
    }

    /** Listeners still attached, for the lifecycle tests. */
    get size() {
        let n = 0;
        for (const set of this.#listeners.values())
            n += set.size;
        return n;
    }
}
