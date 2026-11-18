// The HUD (ADR-002 §6.1, §6.3; UX §4): one St actor tree, built once at enable() and shown or
// hidden. This file is the `Hud` port's adapter: where and how the HUD shows, its grab, and the
// lock gate. What it contains is views/hudView.js.
//
// Two states: focused (a modal grab, typing goes to the prompt) and shown (no grab). The lock
// gate is here too: `show()` and `focus()` refuse while the session is locked, and the actor
// leaves the stage until unlock.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Scope} from '../core/scope.js';
import * as Strings from '../core/strings.js';
import {HudView} from './views/hudView.js';

const WIDTH_PX = 760;
const TOP_PX = 108;
const MARGIN_PX = 32;
const FADE_MS = 150;

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
            accessible_name: Strings.Indicator.appName,
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
        this.#view.placed();
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
