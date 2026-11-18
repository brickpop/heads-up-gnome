// SettingsStore: the one writer of both GSettings schemas (ADR-002 §4, §8.1), in the shell
// and in prefs. `state` holds every key of both schemas (a key name in both throws),
// frozen; `changed` fires with the changed key, whoever wrote it (this process, the other
// one, or `gsettings` on the command line).

import {Emitter} from './emitter.js';

const deepFreeze = value => {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
};

export class SettingsStore extends Emitter {
    #settings;
    #stateKeys;
    #ports;
    #watches;
    state;

    /**
     * @param {object} ports
     * @param {import('./ports.js').KeyValues} ports.settings
     * @param {import('./ports.js').KeyValues} ports.state
     */
    constructor({settings, state}) {
        super();
        this.#settings = settings;
        this.#stateKeys = new Set(state.keys());
        this.#ports = {settings, state};
        const values = {};
        for (const port of [settings, state]) {
            for (const key of port.keys()) {
                if (key in values)
                    throw new Error(`both schemas have the key ${key}`);
                values[key] = port.get(key);
            }
        }
        this.state = deepFreeze(values);
        this.#watches = [settings, state].map(port => port.watch(key => this.#reload(port, key)));
    }

    /** Writes one key; throws on an unknown key or a value of the wrong type. */
    set(key, value) {
        this.#portOf(key).set(key, value);
    }

    /** Back to the defaults: the user's settings only, never the state. */
    reset() {
        for (const key of this.#settings.keys())
            this.#settings.reset(key);
    }

    dispose() {
        this.#watches.forEach(handle => handle.dispose());
        this.#watches = [];
    }

    #portOf(key) {
        if (this.#stateKeys.has(key))
            return this.#ports.state;
        if (key in this.state)
            return this.#ports.settings;
        throw new Error(`unknown setting ${key}`);
    }

    #reload(port, key) {
        this.state = deepFreeze({...this.state, [key]: port.get(key)});
        this.emit('changed', key);
    }
}
