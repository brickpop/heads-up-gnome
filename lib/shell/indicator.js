// The panel indicator (UX §2, §3; ADR-002 §6.3): at the left end of the top bar's right side.
// It draws IndicatorModel (the timer's text, amber while the round waits on the user; the
// cup and its time left while Caffeine or a service holds, in the accent colour) and
// builds its menu from menuModel() each time the menu opens. Left click is the model's click
// (the amber rule); right click, Enter or Space open the menu.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {menuModel} from '../core/menuModel.js';
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

/** Adds or removes a style class. */
function setClass(actor, name, on) {
    if (on)
        actor.add_style_class_name(name);
    else
        actor.remove_style_class_name(name);
}

export class Indicator {
    #stores;
    #scope;
    #button;
    #label;
    #cupIcon;
    #cupLabel;
    #openPreferences;

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
        this.#openPreferences = openPreferences;
        this.#button = new Button(() => stores.indicator.click());

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box hu-indicator'});
        box.add_child(new St.Icon({gicon: W.icon(dir, 'timer'), style_class: 'system-status-icon'}));
        this.#label = new St.Label({style_class: 'hu-indicator-label', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this.#label);
        this.#cupIcon = new St.Icon({gicon: W.icon(dir, 'cup'), style_class: 'system-status-icon hu-indicator-cup', visible: false});
        this.#cupLabel = new St.Label({style_class: 'hu-indicator-label', y_align: Clutter.ActorAlign.CENTER, visible: false});
        box.add_child(this.#cupIcon);
        box.add_child(this.#cupLabel);
        this.#button.add_child(box);
        this.#button.accessible_role = Atk.Role.PUSH_BUTTON;

        Main.panel.addToStatusArea(ROLE, this.#button, 0, 'right');
        scope.add(() => this.#button.destroy());

        const menu = this.#button.menu;
        // Built each time it opens, so its values are those of that moment (as on the Mac).
        scope.connect(menu, 'open-state-changed', (_menu, open) => {
            if (open)
                this.#buildMenu();
            this.#syncPressed();
        });
        // The pressed style while the HUD or the menu is open (UX §2).
        scope.add(stores.hud.on('changed', () => this.#syncPressed()));
        scope.add(stores.indicator.on('changed', () => this.#syncText()));
        this.#syncText();
    }

    /** Hidden on the lock screen, with the HUD (ADR-002 §6.1). */
    setVisible(visible) {
        this.#button.container.visible = visible;
        if (!visible)
            this.#button.menu.close();
    }

    #syncText() {
        const {parts, accessibleName} = this.#stores.indicator.state;
        const timer = parts.find(part => part.kind === 'timer');
        this.#label.text = timer?.text ?? '';
        setClass(this.#label, 'hu-indicator-warn', timer?.warning);
        const cup = parts.find(part => part.kind === 'cup');
        this.#cupIcon.visible = Boolean(cup);
        this.#cupLabel.visible = Boolean(cup?.text);
        this.#cupLabel.text = cup?.text ?? '';
        // Accent while Caffeine holds; the panel's own colour while paused or held by a service.
        setClass(this.#cupIcon, 'hu-indicator-accent', cup?.accent);
        setClass(this.#cupLabel, 'hu-indicator-accent', cup?.accent);
        this.#button.accessible_name = accessibleName;
    }

    #buildMenu() {
        const menu = this.#button.menu;
        menu.removeAll();
        const state = this.#stores.settings.state;
        const shortcut = state['hud-shortcut-status'] === 'ok' ? Strings.accelLabel(state['hud-shortcut-active'][0] ?? '') : '';
        const entries = menuModel({shortcut, focus: this.#stores.focus.snapshot, now: this.#stores.now()});
        for (const entry of entries) {
            if (entry.kind === 'separator')
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            else if (entry.kind === 'header')
                menu.addMenuItem(this.#row(entry.title, entry.shortcut, {header: true}));
            else if (entry.kind === 'note')
                menu.addMenuItem(this.#note(entry.text));
            else if (entry.switchOn !== undefined)
                menu.addMenuItem(this.#switchRow(entry.title, entry.switchOn, entry.action));
            else
                menu.addMenuItem(this.#row(entry.title, entry.value, {warning: entry.warning, action: entry.action}));
        }
    }

    /** One menu row: its title, and its value on the right (dim on the header, amber when it warns). */
    #row(title, value, {header = false, warning = false, action = null}) {
        // The header is a section title: not clickable, but not greyed out like a disabled row.
        const item = new PopupMenu.PopupMenuItem(title, header ? {activate: false, hover: false, can_focus: false} : {});
        item.label.x_expand = true;
        if (value) {
            const classes = ['hu-menu-value'];
            if (header)
                classes.push('popup-inactive-menu-item');
            if (warning)
                classes.push(this.#warnClass());
            item.add_child(new St.Label({text: value, style_class: classes.join(' '), y_align: Clutter.ActorAlign.CENTER}));
        }
        if (action)
            item.connect('activate', () => this.#run(action));
        return item;
    }

    /**
     * The Caffeine row, with the shell's switch. It sets Caffeine to the switch's new state
     * rather than toggling, so a menu left open while Caffeine changed can't invert it.
     */
    #switchRow(title, on, action) {
        const item = new PopupMenu.PopupSwitchMenuItem(title, on);
        item.connect('toggled', () => {
            if (action === 'toggleCaffeine' && item.state !== this.#stores.caffeine.isOn)
                this.#stores.caffeine.toggle();
        });
        return item;
    }

    /** A dim, indented line under the row before it ("Kept awake by Web dev server"). */
    #note(text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false, can_focus: false, style_class: 'popup-menu-item hu-menu-note'});
        return item;
    }

    /** The warn colour that reads on the shell's menu: its dark value on a dark menu. */
    #warnClass() {
        return St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK ? 'hu-menu-warn-dark' : 'hu-menu-warn-light';
    }

    #run(action) {
        const hud = this.#stores.hud;
        if (action === 'openHud')
            this.#afterMenu(() => hud.focus());
        else if (action === 'focus')
            this.#afterMenu(() => hud.focus('focus'));
        else if (action === 'preferences')
            this.#openPreferences();
    }

    /**
     * Runs `fn` once the menu has closed: it gives the keyboard back as it closes, which would
     * otherwise look like a click away from the HUD that `fn` focuses.
     */
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
}
