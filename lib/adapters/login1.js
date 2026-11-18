// systemd-logind on the system bus.

import Gio from 'gi://Gio';

/**
 * Calls fn after each resume from suspend (`PrepareForSleep(false)`). Without a system bus
 * (some containers) it never calls.
 * @returns {import('../core/ports.js').Handle}
 */
export function watchResume(fn) {
    let bus = null;
    let id = 0;
    let disposed = false;
    Gio.bus_get(Gio.BusType.SYSTEM, null, (_source, result) => {
        try {
            bus = Gio.bus_get_finish(result);
        } catch {
            return;
        }
        if (disposed)
            return;
        id = bus.signal_subscribe('org.freedesktop.login1', 'org.freedesktop.login1.Manager',
            'PrepareForSleep', '/org/freedesktop/login1', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _n, params) => {
                const [sleeping] = params.deepUnpack();
                if (!sleeping)
                    fn();
            });
    });
    return {
        dispose: () => {
            disposed = true;
            if (id)
                bus.signal_unsubscribe(id);
            id = 0;
        },
    };
}
