// The Notifier port (ADR-002 §4, §6.7; UX §8): shell notifications from one source, HeadsUp,
// with the timer icon. Titles, bodies and action labels arrive ready from the core's strings
// (G4): this file never builds text and never turns on body markup.
//
// While the screen is locked, notifications still post (the lock screen follows the user's
// GNOME setting), but their buttons and clicks do nothing (G2).

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import * as Strings from '../core/strings.js';

export class Notifier {
    #session;
    #icon;
    #source = null;
    #shown = new Map();
    #listeners = new Set();

    /**
     * @param {object} deps
     * @param {import('../core/ports.js').Session} deps.session
     * @param {import('gi://Gio').default.Icon} deps.icon the timer icon
     */
    constructor({session, icon}) {
        this.#session = session;
        this.#icon = icon;
    }

    /**
     * Shows a notification, replacing any with the same id.
     *
     * @param {{id: string, category: string, title: string, body: string,
     *          actions?: {id: string, label: string}[]}} notification
     */
    post({id, category, title, body, actions = []}) {
        this.withdraw(id);
        const source = this.#ensureSource();
        const notification = new MessageTray.Notification({source, title, body});
        for (const action of actions.slice(0, 3))
            notification.addAction(action.label, () => this.#emit({id, category, action: action.id}));
        notification.connect('activated', () => this.#emit({id, category, action: null}));
        notification.connect('destroy', () => {
            if (this.#shown.get(id) === notification)
                this.#shown.delete(id);
        });
        this.#shown.set(id, notification);
        source.addNotification(notification);
    }

    /** @param {string} id */
    withdraw(id) {
        const notification = this.#shown.get(id);
        this.#shown.delete(id);
        notification?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }

    /**
     * @param {(event: {id: string, category: string, action: string | null}) => void} fn
     * @returns {{dispose(): void}}
     */
    onAction(fn) {
        this.#listeners.add(fn);
        return {dispose: () => this.#listeners.delete(fn)};
    }

    /** Withdraws everything HeadsUp posted. */
    dispose() {
        this.#listeners.clear();
        for (const id of [...this.#shown.keys()])
            this.withdraw(id);
        this.#source?.destroy();
        this.#source = null;
    }

    #emit(event) {
        if (this.#session.locked)
            return;
        for (const fn of [...this.#listeners])
            fn(event);
    }

    /** The shell destroys a source once it holds no notifications, so it is made on demand. */
    #ensureSource() {
        if (this.#source)
            return this.#source;
        const source = new MessageTray.Source({title: Strings.Indicator.appName, icon: this.#icon});
        source.connect('destroy', () => {
            if (this.#source === source)
                this.#source = null;
        });
        Main.messageTray.add(source);
        this.#source = source;
        return source;
    }
}
