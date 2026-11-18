// The `Inhibitor` port: org.gnome.SessionManager.Inhibit and Uninhibit on the session bus
// (ADR-002 §6.5). `gnome-session-inhibit --list` shows each hold by its reason.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAME = 'org.gnome.SessionManager';
const PATH = '/org/gnome/SessionManager';
const TIMEOUT_MS = 5000;

/** @returns {import('../core/ports.js').Inhibitor} */
export function inhibitor(bus = Gio.DBus.session) {
    const call = (method, params) => new Promise((resolve, reject) => {
        bus.call(NAME, PATH, NAME, method, params, null, Gio.DBusCallFlags.NONE, TIMEOUT_MS, null, (_bus, result) => {
            try {
                resolve(bus.call_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
    return {
        async hold(flags, reason) {
            try {
                const [cookie] = (await call('Inhibit', new GLib.Variant('(susu)', ['HeadsUp', 0, reason, flags]))).deepUnpack();
                return {dispose: () => call('Uninhibit', new GLib.Variant('(u)', [cookie])).catch(() => {})};
            } catch {
                return null;
            }
        },
    };
}
