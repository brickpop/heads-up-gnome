// What a test file imports: `test()` to register a test, the assertions, and the ports.
// test/run.js runs what each file registered.

import Gio from 'gi://Gio';

import {keyValues} from '../lib/adapters/gsettings.js';
import {fakePorts} from './fakes.js';

/** The tests of the file being loaded; run.js empties it before each file. */
export const tests = [];

/** Registers a test; `fn` may be async. */
export function test(name, fn) {
    tests.push({name, fn});
}

const show = value => JSON.stringify(value);

export function assertEqual(actual, expected, what = '') {
    if (show(actual) !== show(expected))
        throw new Error(`${what ? `${what}: ` : ''}expected ${show(expected)}, got ${show(actual)}`);
}

export function assertThrows(fn, what = 'it') {
    try {
        fn();
    } catch {
        return;
    }
    throw new Error(`${what} should have thrown`);
}

/**
 * One of our schemas as a port over the memory backend, every key back at its default,
 * then `values` written. It counts live watches (`live`) and records writes (`writes`).
 */
export function schemaPort(id, values = {}) {
    const settings = new Gio.Settings({schema_id: id});
    const port = keyValues(settings);
    port.keys().forEach(key => settings.reset(key));
    Object.entries(values).forEach(([key, value]) => port.set(key, value));
    const watch = port.watch;
    const counted = {...port, writes: [], live: 0};
    counted.set = (key, value) => {
        counted.writes.push([key, value]);
        port.set(key, value);
    };
    counted.watch = fn => {
        const handle = watch(fn);
        counted.live++;
        let live = true;
        return {
            dispose: () => {
                if (live)
                    counted.live--;
                live = false;
                handle.dispose();
            },
        };
    };
    return counted;
}

/** The slice 0 ports: real settings and state at their defaults plus `values`, the rest fakes. */
export function testPorts({settings = {}, state = {}, keys} = {}) {
    return fakePorts({
        settings: schemaPort('org.gnome.shell.extensions.headsup', settings),
        state: schemaPort('org.gnome.shell.extensions.headsup.state', state),
        keys,
    });
}
