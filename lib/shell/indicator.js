// The panel indicator (UX §2, §3; ADR-002 §6.3): at the left end of the top bar's right side.
// Left click toggles the HUD; right click, Enter or Space open the menu. Slice 0 is static:
// the timer and "Idle", and the menu rows that work so far. IndicatorModel and MenuModel
// fill it from slice 1.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Strings from '../core/strings.js';
import * as W from './views/widgets.js';

const ROLE = 'headsup';

const Button = GObject.registerClass(
class HeadsUpIndicatorButton extends PanelMenu.Button {
    /**
     * @param {() => void} onPrimary a left click or a tap
     */
    _init(onPrimary) {
        super._init(0.0, Strings.Indicator.appName, false);
        this._onPrimary = onPrimary;
    }

    // PanelMenu.Button opens its menu on any press; HeadsUp keeps that for the right click and
    // the keyboard only (UX §2).
    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.TOUCH_BEGIN ||
            (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_PRIMARY)) {
            this.menu.close();
            this._onPrimary();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_SECONDARY) {
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.KEY_PRESS) {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space) {
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

export class Indicator {
    #stores;
    #button;
    #header;
    #scope;

    /**
     * @param {object} deps
     * @param {object} deps.stores what createApp() returns
     * @param {string} deps.dir the extension's folder, for the icons
     * @param {() => void} deps.openPreferences
     * @param {import('../core/scope.js').Scope} deps.scope
     */
    constructor({stores, dir, openPreferences, scope}) {
        this.#stores = stores;
        this.#scope = scope;
        this.#button = new Button(() => stores.hud.toggle());

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box hu-indicator'});
        box.add_child(new St.Icon({gicon: W.icon(dir, 'timer'), style_class: 'system-status-icon'}));
        box.add_child(new St.Label({
            text: Strings.Indicator.idle,
            style_class: 'hu-indicator-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.#button.add_child(box);
        this.#button.accessible_role = Atk.Role.PUSH_BUTTON;
        this.#button.accessible_name = Strings.Indicator.accessibleName([Strings.Indicator.idle]);

        const menu = this.#button.menu;
        // A section title: not clickable, but not greyed out like a disabled row either.
        this.#header = new PopupMenu.PopupMenuItem(Strings.Indicator.appName, {activate: false, hover: false, can_focus: false});
        this.#header.label.x_expand = true;
        this.#header.shortcut = new St.Label({style_class: 'popup-inactive-menu-item', y_align: Clutter.ActorAlign.CENTER});
        this.#header.add_child(this.#header.shortcut);
        menu.addMenuItem(this.#header);
        // After the menu has closed: it gives the keyboard back as it closes, which would
        // otherwise look like a click away from the HUD it just focused.
        menu.addAction(Strings.Indicator.openHud, () => this.#afterMenu(() => stores.hud.focus()));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(Strings.Indicator.preferences, () => openPreferences());

        Main.panel.addToStatusArea(ROLE, this.#button, 0, 'right');
        scope.add(() => this.#button.destroy());

        // The pressed style while the HUD or the menu is open (UX §2).
        scope.add(stores.hud.on('changed', () => this.#syncPressed()));
        scope.connect(menu, 'open-state-changed', () => this.#syncPressed());
        scope.add(stores.settings.on('changed', key => {
            if (key === 'hud-shortcut' || key === 'hud-shortcut-status')
                this.#syncHeader();
        }));
        this.#syncHeader();
    }

    /** Hidden on the lock screen, with the HUD (ADR-002 §6.1). */
    setVisible(visible) {
        this.#button.container.visible = visible;
        if (!visible)
            this.#button.menu.close();
    }

    #afterMenu(fn) {
        let id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            id = 0;
            handle.dispose();
            fn();
            return GLib.SOURCE_REMOVE;
        });
        const handle = this.#scope.add(() => id && GLib.source_remove(id));
    }

    #syncPressed() {
        if (this.#stores.hud.state.visible || this.#button.menu.isOpen)
            this.#button.add_style_pseudo_class('checked');
        else
            this.#button.remove_style_pseudo_class('checked');
    }

    /** The current shortcut, dim, only while it works (UX §3). */
    #syncHeader() {
        const state = this.#stores.settings.state;
        const works = state['hud-shortcut-status'] === 'ok';
        this.#header.shortcut.text = works ? Strings.accelLabel(state['hud-shortcut'][0] ?? '') : '';
    }
}
