// The HUD (ADR-002 §6.1, §6.3; UX §4–§7): one St actor tree, built once at enable() and
// shown or hidden. This file is the `Hud` port's adapter and the HUD's frame: header with the
// five tabs and the prompt, the notice bar, the body, and the footer.
//
// Two states: focused (a modal grab, typing goes to the prompt) and shown (no grab). The lock
// gate is here too: `show()` and `focus()` refuse while the session is locked, and the actor
// leaves the stage until unlock.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TABS} from '../core/hud.js';
import {Scope} from '../core/scope.js';
import * as Strings from '../core/strings.js';
import {Welcome} from './views/chat/welcome.js';
import * as W from './views/widgets.js';

/** Each tab's icon (UX §5). The core's TABS gives their order, which Ctrl+1–5 follow. */
const TAB_ICONS = {chat: 'chat', focus: 'timer', caffeine: 'cup', services: 'services', commands: 'terminal'};

const WIDTH_PX = 760;
const TOP_PX = 108;
const MARGIN_PX = 32;
const FADE_MS = 150;
// Hardware key codes of the 1–5 row (evdev + 8): Ctrl+1–5 follow the keys' position, so they
// work on layouts where those keys type other characters (AZERTY), as on the Mac.
const DIGIT_ROW_CODES = [10, 11, 12, 13, 14];

export class Hud {
    /** @type {Date | null} */
    focusedSince = null;

    #session;
    #clock;
    #scope = new Scope();
    #root;
    #onStage = false;
    /** Shown or focused, even while the fade-in runs; false from the start of the fade-out. */
    #shown = false;
    #grab = null;
    #stores = null;
    #view = null;
    /** 'show' or 'focus', asked for before the view was built (the welcome at enable()). */
    #pending = null;

    /**
     * @param {object} deps
     * @param {import('../core/ports.js').Session} deps.session
     * @param {import('../core/ports.js').Clock} deps.clock
     */
    constructor({session, clock}) {
        this.#session = session;
        this.#clock = clock;
        this.#root = new St.BoxLayout({
            style_class: 'hu-hud',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            visible: false,
            opacity: 0,
            accessible_role: Atk.Role.DIALOG,
            accessible_name: 'HeadsUp',
        });
        this.#scope.add(() => this.#root.destroy());
        // Tab and the arrow keys move focus inside the HUD, as in other shell surfaces.
        global.focus_manager.add_group(this.#root);
        this.#scope.add(() => global.focus_manager.remove_group(this.#root));
        this.#scope.connect(this.#root, 'captured-event', (_actor, event) => this.#onCapturedEvent(event));
        this.#scope.connect(global.stage, 'notify::key-focus', () => this.#onKeyFocusChanged());
        this.#scope.connect(Main.overview, 'showing', () => this.#shellTookGrab());
        this.#scope.add(session.watch(locked => (locked ? this.#leaveStage() : this.#enterStage())));
        if (!session.locked)
            this.#enterStage();
    }

    /**
     * Builds the views once the stores exist (the stores need this adapter first).
     *
     * @param {object} stores what createApp() returns
     * @param {object} shell
     * @param {string} shell.dir the extension's folder, for the icons
     * @param {() => void} shell.openPreferences
     */
    attach(stores, {dir, openPreferences}) {
        this.#stores = stores;
        this.#view = new HudView({root: this.#root, stores, dir, openPreferences, scope: this.#scope.child()});
        this.#scope.connect(St.Settings.get(), 'notify::color-scheme', () => this.#view.restyle());
        this.#scope.connect(St.Settings.get(), 'notify::high-contrast', () => this.#view.restyle());
        const pending = this.#pending;
        this.#pending = null;
        if (pending === 'show')
            this.show();
        else if (pending === 'focus')
            this.focus();
    }

    // ---- The Hud port ----

    /** Shown with no grab: a held grab is dropped on purpose, the HUD stays. */
    show() {
        if (this.#session.locked || !this.#onStage)
            return;
        if (!this.#view) {
            this.#pending = 'show';
            return;
        }
        this.#dropGrab();
        if (!this.#shown)
            this.#appear();
        this.#view.setFocused(false);
    }

    /**
     * Shown with the grab. Returns false when the grab was refused (another grab holds the
     * keyboard): the HUD then stays shown without it. A focus asked for before the view
     * exists is played by attach() and counts as taken.
     *
     * @returns {boolean}
     */
    focus() {
        if (this.#session.locked || !this.#onStage)
            return false;
        if (!this.#view) {
            this.#pending = 'focus';
            return true;
        }
        if (!this.#shown)
            this.#appear();
        if (!this.#grab && !this.#takeGrab()) {
            this.#view.setFocused(false);
            return false;
        }
        this.#view.focusPrompt();
        this.#view.setFocused(true);
        return true;
    }

    hide() {
        this.#pending = null;
        this.#dropGrab();
        this.#view?.clearPrompt();
        if (!this.#shown)
            return;
        this.#shown = false;
        this.#root.remove_all_transitions();
        // ease() already skips the animation when Animations are off.
        this.#root.ease({
            opacity: 0,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                if (!this.#shown)
                    this.#root.visible = false;
            },
        });
    }

    dispose() {
        this.#dropGrab();
        this.#leaveStage();
        this.#scope.dispose();
    }

    /**
     * Gives the keyboard to the window under (x, y) on this workspace, the top one first: with
     * click-away off, a click on another window makes it the one you type in. The click itself
     * isn't delivered, as with GNOME's own popups (UX §4).
     */
    #activateWindowAt(x, y) {
        const workspace = global.workspace_manager.get_active_workspace();
        for (const actor of global.get_window_actors().reverse()) {
            const window = actor.meta_window;
            if (!window || window.minimized || !actor.visible || !window.located_on_workspace(workspace))
                continue;
            const frame = window.get_frame_rect();
            if (x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height) {
                window.activate(global.get_current_time());
                return;
            }
        }
    }

    // ---- Showing ----

    #appear() {
        this.#view.restyle();
        this.#place();
        this.#shown = true;
        this.#root.remove_all_transitions();
        this.#root.visible = true;
        this.#root.ease({opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    /** Centred on the monitor under the pointer, 108 px from its top, at most 760 px wide. */
    #place() {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const index = global.display.get_current_monitor();
        const monitor = Main.layoutManager.monitors[index];
        const workArea = Main.layoutManager.getWorkAreaForMonitor(index);
        const width = Math.min(WIDTH_PX * scaleFactor, monitor.width - MARGIN_PX * scaleFactor);
        const top = monitor.y + TOP_PX * scaleFactor;
        const maxHeight = workArea.y + workArea.height - top - MARGIN_PX * scaleFactor;
        this.#root.set_position(Math.round(monitor.x + (monitor.width - width) / 2), Math.round(top));
        this.#root.width = Math.round(width);
        // CSS lengths are scaled by St, so the limit goes in unscaled pixels.
        this.#root.style = `max-height: ${Math.floor(maxHeight / scaleFactor)}px;`;
    }

    // ---- The lock gate (G2) ----

    /** Above full-screen windows and the overview, never on the lock screen. */
    #enterStage() {
        if (this.#onStage)
            return;
        Main.layoutManager.addTopChrome(this.#root, {affectsInputRegion: true});
        this.#onStage = true;
    }

    /** On lock: off the stage, with no grab. The core plays a waiting auto-open after unlock. */
    #leaveStage() {
        this.#dropGrab();
        if (!this.#onStage)
            return;
        this.#shown = false;
        this.#root.remove_all_transitions();
        this.#root.visible = false;
        this.#root.opacity = 0;
        Main.layoutManager.removeChrome(this.#root);
        this.#onStage = false;
    }

    // ---- The grab ----

    #takeGrab() {
        const grab = Main.pushModal(this.#root, {actionMode: Shell.ActionMode.POPUP});
        if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
            Main.popModal(grab);
            return false;
        }
        this.#grab = grab;
        this.focusedSince = this.#clock.now();
        return true;
    }

    /** Drops our grab on purpose: the store isn't told (ADR-002 §4, item 6). */
    #dropGrab() {
        if (!this.#grab)
            return;
        const grab = this.#grab;
        this.#grab = null;
        this.focusedSince = null;
        Main.popModal(grab);
        this.#view?.setFocused(false);
    }

    /** A click outside, another modal or the overview took the keyboard. */
    #shellTookGrab() {
        if (!this.#grab)
            return;
        this.#dropGrab();
        this.#stores.hud.didResignKey();
    }

    #onKeyFocusChanged() {
        const focus = global.stage.key_focus;
        if (this.#grab && focus && !this.#root.contains(focus))
            this.#shellTookGrab();
    }

    #contains(event) {
        const [x, y] = event.get_coords();
        const [left, top] = this.#root.get_transformed_position();
        const [width, height] = this.#root.get_transformed_size();
        return x >= left && x < left + width && y >= top && y < top + height;
    }

    #onCapturedEvent(event) {
        const type = event.type();
        const press = type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN;
        if (press && this.#grab && !this.#contains(event)) {
            // Click-away on: the store hides the HUD. Off: it stays shown without the
            // keyboard, and the window clicked gets the keyboard.
            this.#shellTookGrab();
            if (!this.#stores.settings.state['close-on-click-outside'])
                this.#activateWindowAt(...event.get_coords());
            return Clutter.EVENT_STOP;
        }
        if (press && !this.#grab) {
            // A click on the shown HUD gives it the keyboard; the click still reaches its target.
            this.#stores.hud.focus();
            return Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.KEY_PRESS && this.#grab)
            return this.#view.onKeyPress(event);
        return Clutter.EVENT_PROPAGATE;
    }
}

/** The HUD's contents: header, notice bar, body, footer. Reads the stores; never writes GSettings. */
class HudView {
    #root;
    #stores;
    #dir;
    #openPreferences;
    #scope;
    #tabs = new Map();
    #prompt;
    #notice;
    #body;
    #welcome = null;

    constructor({root, stores, dir, openPreferences, scope}) {
        this.#root = root;
        this.#stores = stores;
        this.#dir = dir;
        this.#openPreferences = openPreferences;
        this.#scope = scope;

        const header = new St.BoxLayout({style_class: 'hu-header', x_expand: true});
        this.#prompt = new St.Entry({
            style_class: 'hu-prompt',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            accessible_name: Strings.Prompt.accessibleName,
        });
        for (const id of TABS)
            header.add_child(this.#tabCell(id, TAB_ICONS[id]));

        this.#notice = this.#noticeBar();
        this.#body = new St.BoxLayout({style_class: 'hu-body', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({
            child: this.#body,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        const footer = new St.BoxLayout({style_class: 'hu-footer', x_expand: true});
        for (const hint of Strings.Hints.tabs)
            footer.add_child(W.hint(hint));

        root.add_child(header);
        root.add_child(this.#notice);
        root.add_child(scroll);
        root.add_child(footer);

        this.#scope.add(stores.hud.on('changed', () => this.#sync()));
        this.#scope.add(stores.settings.on('changed', key => this.#onSetting(key)));
        this.#sync();
    }

    focusPrompt() {
        this.#prompt.grab_key_focus();
    }

    /** Closing clears what was typed; the tab stays (as on the Mac). */
    clearPrompt() {
        this.#prompt.text = '';
    }

    /** Shown without the keyboard: the prompt dims and has no cursor (UX §4). */
    setFocused(focused) {
        if (focused)
            this.#prompt.remove_style_class_name('hu-prompt-dim');
        else
            this.#prompt.add_style_class_name('hu-prompt-dim');
    }

    /** The scheme classes on the root: HeadsUp's Appearance, else the shell's style (UX §15). */
    restyle() {
        const dark = this.#isDark();
        const highContrast = St.Settings.get().high_contrast;
        this.#root.style_class = `hu-hud ${dark ? 'hu-dark' : 'hu-light'}${highContrast ? ' hu-hc' : ''}`;
    }

    tooltipScheme() {
        return this.#isDark() ? 'hu-tooltip-dark' : 'hu-tooltip-light';
    }

    #isDark() {
        const appearance = this.#stores.settings.state['appearance'];
        if (appearance !== 'system')
            return appearance === 'dark';
        return St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK;
    }

    /** One tab: its icon button, and the prompt beside it while it's the active tab. */
    #tabCell(id, icon) {
        const cell = new St.BoxLayout({style_class: 'hu-tab', reactive: true, track_hover: true});
        const button = new St.Button({
            style_class: 'hu-tab-icon',
            can_focus: true,
            x_expand: true,
            child: new St.Icon({gicon: W.icon(this.#dir, icon)}),
            accessible_role: Atk.Role.PAGE_TAB,
            accessible_name: Strings.Tabs.title(id),
        });
        this.#scope.connect(button, 'clicked', () => this.#stores.hud.selectTab(id));
        // The focus ring goes round the whole cell: the icon of an inactive tab, the icon and
        // prompt of the active one.
        this.#scope.connect(button, 'key-focus-in', () => cell.add_style_pseudo_class('focus'));
        this.#scope.connect(button, 'key-focus-out', () => cell.remove_style_pseudo_class('focus'));
        W.hoverLabel(this.#scope, button, Strings.Tabs.tooltip(id), () => this.tooltipScheme());
        cell.add_child(button);
        this.#tabs.set(id, {cell, button});
        return cell;
    }

    /** The one-time notice after a second layout took Super+Space back (UX §7). */
    #noticeBar() {
        const bar = new St.BoxLayout({style_class: 'hu-notice', x_expand: true, visible: false});
        bar.add_child(new St.Icon({gicon: W.icon(this.#dir, 'warning'), style_class: 'hu-warn', y_align: Clutter.ActorAlign.CENTER}));
        bar.add_child(new St.Label({
            text: Strings.LayoutNotice.text,
            style_class: 'hu-notice-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const open = W.button({label: Strings.Common.openPreferences, kind: 'secondary'});
        open.y_align = Clutter.ActorAlign.CENTER;
        this.#scope.connect(open, 'clicked', () => {
            this.#stores.hud.dismissLayoutNotice();
            this.#openPreferences();
        });
        const dismiss = W.button({gicon: W.icon(this.#dir, 'close'), kind: 'ghost', accessibleName: Strings.Common.dismiss});
        dismiss.y_align = Clutter.ActorAlign.CENTER;
        this.#scope.connect(dismiss, 'clicked', () => this.#stores.hud.dismissLayoutNotice());
        bar.add_child(open);
        bar.add_child(dismiss);
        return bar;
    }

    #onSetting(key) {
        if (key === 'appearance')
            this.restyle();
        if (key === 'layout-notice' || key === 'hud-shortcut-status' || key === 'hud-shortcut')
            this.#sync();
    }

    /** Puts the stores' state on screen. */
    #sync() {
        const {tab, showsWelcome} = this.#stores.hud.state;
        for (const [id, {cell, button}] of this.#tabs) {
            const active = id === tab;
            cell.x_expand = active;
            if (active) {
                cell.add_style_pseudo_class('checked');
                button.x_expand = false;
                button.add_accessible_state(Atk.StateType.SELECTED);
                if (this.#prompt.get_parent() !== cell) {
                    this.#prompt.get_parent()?.remove_child(this.#prompt);
                    cell.add_child(this.#prompt);
                }
            } else {
                cell.remove_style_pseudo_class('checked');
                button.x_expand = true;
                button.remove_accessible_state(Atk.StateType.SELECTED);
            }
        }
        this.#prompt.hint_text = tab === 'chat' ? Strings.Prompt.chatNoModel : Strings.Prompt.otherTab;
        this.#notice.visible = this.#stores.settings.state['layout-notice'];
        this.#syncBody(showsWelcome);
    }

    /** Slice 0: the body is empty, except the welcome on Chat. */
    #syncBody(showsWelcome) {
        if (showsWelcome && !this.#welcome) {
            this.#welcome = new Welcome({
                stores: this.#stores,
                openPreferences: this.#openPreferences,
                scope: this.#scope.child(),
            });
            this.#body.add_child(this.#welcome.actor);
        } else if (!showsWelcome && this.#welcome) {
            this.#welcome.dispose();
            this.#welcome = null;
        }
    }

    /** Tab order (UX §6): the prompt, the tabs, the body's controls, then the notice bar's. */
    #moveFocus(step) {
        const order = [this.#prompt, ...[...this.#tabs.values()].map(tab => tab.button)];
        const collect = actor => {
            for (const child of actor.get_children()) {
                if (!child.visible)
                    continue;
                if (child instanceof St.Widget && child.can_focus)
                    order.push(child);
                else
                    collect(child);
            }
        };
        collect(this.#body);
        if (this.#notice.visible)
            collect(this.#notice);
        const focus = global.stage.key_focus;
        const found = order.findIndex(actor => actor === focus || actor.contains(focus));
        // From outside the order, Tab starts at the prompt and Shift+Tab at the last control.
        const index = found >= 0 ? found : (step > 0 ? -1 : 0);
        order[(index + step + order.length) % order.length].grab_key_focus();
    }

    /** The HUD's keys while it has the keyboard (UX §6). */
    onKeyPress(event) {
        const key = event.get_key_symbol();
        const ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const hud = this.#stores.hud;
        const digit = DIGIT_ROW_CODES.indexOf(event.get_key_code());
        if (ctrl && digit >= 0) {
            hud.selectTab(TABS[digit]);
            return Clutter.EVENT_STOP;
        }
        if (ctrl && (key === Clutter.KEY_Page_Up || key === Clutter.KEY_KP_Page_Up)) {
            hud.previousTab();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && (key === Clutter.KEY_Page_Down || key === Clutter.KEY_KP_Page_Down)) {
            hud.nextTab();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && key === Clutter.KEY_comma) {
            hud.hide();
            this.#openPreferences();
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab) {
            const back = key === Clutter.KEY_ISO_Left_Tab ||
                (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
            this.#moveFocus(back ? -1 : 1);
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Escape) {
            // The Esc cascade: clear the prompt first, then close.
            if (this.#prompt.text)
                this.#prompt.text = '';
            else
                hud.hide();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
}
