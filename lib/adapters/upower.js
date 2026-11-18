// The `Power` port: UPower's OnBattery on the system bus, for "Only on power adapter"
// (ADR-002 §6.5). Without UPower (a desktop, a container) the computer reads as on power.

import Gio from 'gi://Gio';

const NAME = 'org.freedesktop.UPower';
const PATH = '/org/freedesktop/UPower';

/**
 * @param {import('../core/ports.js').Log} log  one code when UPower can't be reached
 * @returns {import('../core/ports.js').Power & {dispose(): void}}
 */
export function power(log) {
    const watchers = new Set();
    let proxy = null;
    let signal = 0;
    let disposed = false;
    const port = {
        onBattery: false,
        watch(fn) {
            watchers.add(fn);
            return {dispose: () => watchers.delete(fn)};
        },
        dispose() {
            disposed = true;
            if (signal)
                proxy.disconnect(signal);
            signal = 0;
            watchers.clear();
        },
    };
    const read = () => {
        const value = proxy.get_cached_property('OnBattery')?.unpack() === true;
        if (value !== port.onBattery) {
            port.onBattery = value;
            [...watchers].forEach(fn => fn());
        }
    };
    Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null, NAME, PATH, NAME, null, (_s, result) => {
        try {
            proxy = Gio.DBusProxy.new_for_bus_finish(result);
        } catch {
            log('power.upower-missing');
            return;
        }
        if (disposed)
            return;
        // No owner: UPower isn't there (a desktop without it, a container). On power, said once.
        if (!proxy.g_name_owner)
            log('power.upower-missing');
        signal = proxy.connect('g-properties-changed', read);
        read();
    });
    return port;
}
