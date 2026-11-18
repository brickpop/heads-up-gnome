// Owns every handle the extension creates (ADR-002 §5): timeouts, signal connections,
// D-Bus subscriptions, subprocesses, cancellables, inhibitor cookies. A handle is anything
// with `dispose()`. `enable()` creates the root scope; `disable()` disposes it, and every
// handle goes, newest first.

export class Scope {
    #handles = new Set();
    #disposed = false;

    /**
     * Takes ownership of a handle, or of a function to call on dispose. Returns a handle
     * whose `dispose()` disposes it now and forgets it. Once the scope is disposed, a handle
     * added late (an async result arriving after `disable()`) is disposed at once.
     */
    add(handle) {
        const inner = typeof handle === 'function' ? {dispose: handle} : handle;
        const owned = {
            dispose: () => {
                if (!this.#handles.delete(owned))
                    return;
                inner.dispose();
            },
        };
        this.#handles.add(owned);
        if (this.#disposed)
            owned.dispose();
        return owned;
    }

    /** Connects a GObject signal (or any `connect`/`disconnect` pair) for the scope's life. */
    connect(object, signal, fn) {
        const id = object.connect(signal, fn);
        return this.add(() => object.disconnect(id));
    }

    /** A scope owned by this one: disposing either disposes the child. */
    child() {
        const child = new Scope();
        const owned = this.add(() => child.dispose());
        child.add(() => owned.dispose());
        return child;
    }

    get disposed() {
        return this.#disposed;
    }

    /** Handles still owned, for the lifecycle tests. */
    get size() {
        return this.#handles.size;
    }

    /**
     * Disposes every handle, newest first. One that throws doesn't stop the others; the
     * errors are returned for the caller to log.
     */
    dispose() {
        this.#disposed = true;
        const errors = [];
        for (const handle of [...this.#handles].reverse()) {
            try {
                handle.dispose();
            } catch (error) {
                errors.push(error);
            }
        }
        return errors;
    }
}
