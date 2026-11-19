// The welcome (UX §7): in the Chat body on the extension's first enable, until the HUD closes.
// Its first line follows the wake shortcut's status; when the shortcut doesn't work, Open
// Preferences leads to the Wake Shortcut row. Set up a model joins it with the Chat page (slice 5).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Strings from '../../../core/strings.js';
import * as W from '../widgets.js';

export class Welcome {
    #stores;
    #scope;
    #line;
    #open;

    /**
     * @param {object} deps
     * @param {object} deps.stores what createApp() returns
     * @param {import('../../../core/scope.js').Scope} deps.scope owned by the HUD view
     */
    constructor({stores, scope}) {
        this.#stores = stores;
        this.#scope = scope;

        this.actor = new St.BoxLayout({
            style_class: 'hu-welcome',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const title = new St.Label({
            text: Strings.Welcome.title,
            style_class: 'hu-welcome-title',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const lines = new St.BoxLayout({style_class: 'hu-welcome-lines', orientation: Clutter.Orientation.VERTICAL});
        this.#line = new St.Label({style_class: 'hu-ink-2', x_align: Clutter.ActorAlign.CENTER});
        this.#line.clutter_text.line_wrap = true;
        this.#open = W.button({label: Strings.Common.openPreferences, kind: 'secondary'});
        this.#open.x_align = Clutter.ActorAlign.CENTER;
        scope.connect(this.#open, 'clicked', () => {
            // General, at the Wake Shortcut row; the HUD closes.
            stores.openPreferences('general');
        });
        const later = new St.Label({
            text: Strings.Welcome.changeLater,
            style_class: 'hu-ink-3',
            x_align: Clutter.ActorAlign.CENTER,
        });
        lines.add_child(this.#line);
        lines.add_child(this.#open);
        this.actor.add_child(title);
        this.actor.add_child(lines);
        this.actor.add_child(later);
        // Orca reads the whole welcome when it appears.
        this.actor.label_actor = title;

        scope.add(stores.settings.on('changed', key => {
            if (key === 'hud-shortcut-status' || key === 'hud-shortcut')
                this.#sync();
        }));
        this.#sync();
    }

    #sync() {
        const state = this.#stores.settings.state;
        const status = state['hud-shortcut-status'];
        this.#line.text = Strings.Welcome.line(status, Strings.accelLabel(state['hud-shortcut'][0] ?? ''));
        this.#open.visible = Strings.Welcome.needsPreferences(status);
    }

    dispose() {
        this.#scope.dispose();
        this.actor.destroy();
    }
}
