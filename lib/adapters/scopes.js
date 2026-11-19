// systemd's user manager on the session bus: stops a service's scope, or every HeadsUp scope by
// pattern (ADR-002 §6.4, N4b). Calls aren't awaited by the callers: systemd sends SIGTERM to
// every process of the scope, then SIGKILL after TimeoutStopSec, so nothing stays scheduled in
// the shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAME = 'org.freedesktop.systemd1';
const PATH = '/org/freedesktop/systemd1';
const MANAGER = 'org.freedesktop.systemd1.Manager';
/** Every scope HeadsUp starts is named headsup-<id>-<run>.scope. */
export const SCOPE_PATTERN = 'headsup-*.scope';

/** True for a unit name HeadsUp may stop: one of its own scopes. */
export const ownScope = unit => /^headsup-[0-9a-f-]{36}-[0-9a-f]{8}\.scope$/.test(unit);

/** @param {import('../core/ports.js').Log} log */
export function scopes(log, bus = Gio.DBus.session) {
    // `quiet`: stopping a scope that is already gone is a no-op, not an error to log.
    const call = (method, params, type, quiet = false) => new Promise(resolve => {
        bus.call(NAME, PATH, MANAGER, method, params, type ? new GLib.VariantType(type) : null,
            Gio.DBusCallFlags.NONE, 5000, null, (_bus, result) => {
                try {
                    resolve(bus.call_finish(result));
                } catch {
                    if (!quiet)
                        log('services.systemd-call-failed', {method});
                    resolve(null);
                }
            });
    });
    const stopUnit = unit => {
        if (!ownScope(unit))
            return Promise.resolve(null);
        return call('StopUnit', new GLib.Variant('(ss)', [unit, 'replace']), '(o)', true);
    };
    return {
        stopUnit,
        /** Stops every HeadsUp scope, the ones the store knows or not (N4b). */
        async stopAll() {
            const reply = await call('ListUnitsByPatterns', new GLib.Variant('(asas)', [[], [SCOPE_PATTERN]]), '(a(ssssssouso))');
            const units = reply ? reply.deepUnpack()[0].map(row => row[0]).filter(ownScope) : [];
            await Promise.all(units.map(stopUnit));
            return units.length;
        },
    };
}
