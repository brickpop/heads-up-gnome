// The HUD's contents (UX §4–§7): the header with the five tabs and the prompt, the notice bar,
// the body, and the footer. It draws the stores and calls their methods; what keys do, what
// the prompt suggests and what the footer says are the core's (keys.js, HudStore). The body
// shows, in this order: the suggestions while there are rows, the welcome on Chat, or the
// active tab's view.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {TABS} from '../../core/hud.js';
import {HUD_KEYS} from '../../core/keys.js';
import * as Strings from '../../core/strings.js';
import {Welcome} from './chat/welcome.js';
import {CaffeineView} from './caffeine/caffeineView.js';
import {FocusView} from './focus/focusView.js';
import {ServicesView} from './services/servicesView.js';
import {Suggestions} from './suggestions.js';
import {TabView} from './tabView.js';
import * as W from './widgets.js';

/** Each tab's icon (UX §5). The core's TABS gives their order, which Ctrl+1–5 follow. */
const TAB_ICONS = {chat: 'chat', focus: 'timer', caffeine: 'cup', services: 'services', commands: 'terminal'};
// Hardware key codes of the 1–5 row (evdev + 8): Ctrl+1–5 follow the keys' position, so they
// work on layouts where those keys type other characters (AZERTY), as on the Mac.
const DIGIT_ROW_CODES = [10, 11, 12, 13, 14];
/**
 * The keysyms of the core's key map (keys.js HUD_KEYS), to their GDK names: the shell has no
 * keyval-to-name call, and Clutter's KEY_<name> constants use the same names. Keypad and ISO
 * keys are aliases of the main ones.
 */
const KEY_NAMES = new Map();
for (const {accel} of HUD_KEYS) {
    const name = accel.replace(/<[^>]+>/g, '');
    const keyval = Clutter[`KEY_${name}`];
    if (keyval !== undefined)
        KEY_NAMES.set(keyval, name);
}
for (const [alias, name] of [['KP_Page_Up', 'Page_Up'], ['KP_Page_Down', 'Page_Down'], ['ISO_Enter', 'Return'],
    ['KP_Left', 'Left'], ['KP_Right', 'Right'], ['KP_Up', 'Up'], ['KP_Down', 'Down']])
    KEY_NAMES.set(Clutter[`KEY_${alias}`], name);

/** The key's name for the core: the 1–5 row by position, else its GDK name (letters in lower case). */
function keyName(event) {
    const digit = DIGIT_ROW_CODES.indexOf(event.get_key_code());
    if (digit >= 0)
        return String(digit + 1);
    let keyval = event.get_key_symbol();
    // With Shift, a letter's keysym is the capital one (A–Z are 0x41–0x5a, a–z 0x20 higher).
    if (keyval >= 0x41 && keyval <= 0x5a)
        keyval += 0x20;
    return KEY_NAMES.get(keyval) ?? null;
}

export class HudView {
    #root;
    #stores;
    #dir;
    #scope;
    #tabs = new Map();
    #prompt;
    #notice;
    #body;
    #hints;
    #toast;
    /** The footer's pills on the right: Focus's and Caffeine's, each hidden while it has none. */
    #pills;
    #toastBox;
    #suggestions;
    /** What the body shows now: {kind: 'welcome'|'suggestions'|'tab', view, actor}. */
    #content = null;
    #ticking = 0;
    #toastSeq = 0;

    /**
     * @param {object} deps
     * @param {St.BoxLayout} deps.root the HUD's actor
     * @param {object} deps.stores what createApp() returns
     * @param {string} deps.dir the extension's folder
     * @param {import('../../core/scope.js').Scope} deps.scope
     */
    constructor({root, stores, dir, scope}) {
        this.#root = root;
        this.#stores = stores;
        this.#dir = dir;
        this.#scope = scope;

        const header = new St.BoxLayout({style_class: 'hu-header', x_expand: true});
        this.#prompt = new St.Entry({
            style_class: 'hu-prompt',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            accessible_name: Strings.Prompt.accessibleName,
        });
        scope.connect(this.#prompt.clutter_text, 'text-changed', () => this.#onInput());
        scope.connect(this.#prompt.clutter_text, 'activate', () => stores.hud.runSelected());
        for (const id of TABS)
            header.add_child(this.#tabCell(id));

        this.#notice = this.#noticeBar();
        this.#suggestions = new Suggestions({dir, hud: stores.hud});
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
        this.#hints = new St.BoxLayout({style_class: 'hu-hints', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        // A toast takes the hints' place: a check in the accent, then its text, which Orca
        // reads as a notification.
        this.#toast = new St.Label({y_align: Clutter.ActorAlign.CENTER, accessible_role: Atk.Role.NOTIFICATION});
        this.#toastBox = new St.BoxLayout({style_class: 'hu-toast', x_expand: true, visible: false});
        this.#toastBox.add_child(new St.Icon({gicon: W.icon(dir, 'check'), y_align: Clutter.ActorAlign.CENTER}));
        this.#toastBox.add_child(this.#toast);
        // The pills: Focus's starts with the timer, Caffeine's with the cup ("Awake 58m").
        this.#pills = [['focus', 'timer'], ['caffeine', 'cup']].map(([id, icon]) => {
            const label = new St.Label({style_class: 'hu-tnum', y_align: Clutter.ActorAlign.CENTER});
            const box = new St.BoxLayout({style_class: 'hu-pill', y_align: Clutter.ActorAlign.CENTER, visible: false});
            box.add_child(new St.Icon({gicon: W.icon(dir, icon), y_align: Clutter.ActorAlign.CENTER}));
            box.add_child(label);
            return {id, box, label};
        });
        footer.add_child(this.#hints);
        footer.add_child(this.#toastBox);
        for (const {box} of this.#pills)
            footer.add_child(box);

        root.add_child(header);
        root.add_child(this.#notice);
        root.add_child(scroll);
        root.add_child(footer);

        scope.add(stores.hud.on('changed', () => this.#sync()));
        scope.add(stores.focus.on('changed', () => this.#syncFooter()));
        scope.add(stores.caffeine.on('changed', () => this.#syncFooter()));
        scope.add(stores.settings.on('changed', key => this.#onSetting(key)));
        scope.add(() => this.#stopTicking());
        this.#sync();
    }

    focusPrompt() {
        this.#prompt.grab_key_focus();
    }

    /** The HUD was placed, maybe at a new width: the break options' grid follows it. */
    placed() {
        if (this.#content?.view instanceof FocusView)
            this.#content.view.render();
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
        const highContrast = St.Settings.get().high_contrast;
        this.#root.style_class = `hu-hud ${this.#isDark() ? 'hu-dark' : 'hu-light'}${highContrast ? ' hu-hc' : ''}`;
    }

    #isDark() {
        const appearance = this.#stores.settings.state['appearance'];
        if (appearance !== 'system')
            return appearance === 'dark';
        return St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK;
    }

    /** The hover label on `widget`, owned by `scope` (a view's own, when the view rebuilds). */
    #hoverLabel(scope, widget, text) {
        W.hoverLabel(scope, widget, text, () => (this.#isDark() ? 'hu-tooltip-dark' : 'hu-tooltip-light'));
    }

    // ---- Header ----

    /** One tab: its icon button with the activity dot, and the prompt beside it while it's active. */
    #tabCell(id) {
        const cell = new St.BoxLayout({style_class: 'hu-tab', reactive: true, track_hover: true});
        const icon = new St.Widget({layout_manager: new Clutter.BinLayout()});
        icon.add_child(new St.Icon({gicon: W.icon(this.#dir, TAB_ICONS[id]), x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        const dot = new St.Widget({style_class: 'hu-dot hu-tab-dot', x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, visible: false});
        icon.add_child(dot);
        const button = new St.Button({
            style_class: 'hu-tab-icon',
            can_focus: true,
            x_expand: true,
            child: icon,
            accessible_role: Atk.Role.PAGE_TAB,
            accessible_name: Strings.Tabs.title(id),
        });
        this.#scope.connect(button, 'clicked', () => this.#stores.hud.selectTab(id));
        // The focus ring goes round the whole cell: the icon of an inactive tab, the icon and
        // prompt of the active one.
        this.#scope.connect(button, 'key-focus-in', () => cell.add_style_pseudo_class('focus'));
        this.#scope.connect(button, 'key-focus-out', () => cell.remove_style_pseudo_class('focus'));
        this.#hoverLabel(this.#scope, button, Strings.Tabs.tooltip(id));
        cell.add_child(button);
        this.#tabs.set(id, {cell, button, dot});
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
            this.#parkFocus(bar);
            this.#stores.hud.dismissLayoutNotice();
            this.#stores.openPreferences('general');
        });
        const dismiss = W.button({gicon: W.icon(this.#dir, 'close'), kind: 'ghost', accessibleName: Strings.Common.dismiss});
        dismiss.y_align = Clutter.ActorAlign.CENTER;
        this.#scope.connect(dismiss, 'clicked', () => {
            this.#parkFocus(bar);
            this.#stores.hud.dismissLayoutNotice();
        });
        bar.add_child(open);
        bar.add_child(dismiss);
        return bar;
    }

    /**
     * Moves the keyboard focus to the prompt when it is inside `actor`, before `actor` goes or
     * hides: a focused actor that is destroyed leaves the focus on the stage, which the HUD
     * would read as the shell taking its keyboard.
     */
    #parkFocus(actor) {
        if (actor.contains(global.stage.key_focus))
            this.focusPrompt();
    }

    // ---- State to screen ----

    #onSetting(key) {
        if (key === 'appearance')
            this.restyle();
        if (key === 'layout-notice')
            this.#sync();
    }

    #sync() {
        const {tab, visible} = this.#stores.hud.state;
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
        // The store holds the prompt's text; the entry mirrors it (Esc and Enter clear it there).
        const {input} = this.#stores.hud.state;
        if (this.#prompt.text !== input)
            this.#prompt.text = input;
        this.#suggestions.sync();
        const notice = this.#stores.settings.state['layout-notice'];
        if (!notice)
            this.#parkFocus(this.#notice);
        this.#notice.visible = notice;
        this.#syncBody();
        this.#syncFooter();
        // The user sees the Services tab: a failure is seen, and its red dot goes.
        if (visible && tab === 'services')
            this.#stores.services.sawServices();
        if (visible)
            this.#startTicking();
        else
            this.#stopTicking();
    }

    /** The body: suggestions while the prompt matches, else the welcome, else the tab's view. */
    #syncBody() {
        const {tab, showsWelcome} = this.#stores.hud.state;
        let kind = `tab:${tab}`;
        if (this.#stores.hud.state.suggestions.length)
            kind = 'suggestions';
        else if (showsWelcome)
            kind = 'welcome';
        if (this.#content?.kind === kind)
            return;
        if (this.#content) {
            this.#parkFocus(this.#content.actor);
            this.#body.remove_child(this.#content.actor);
            // The suggestions list lives on; the other views are rebuilt when they come back.
            if (this.#content.kind !== 'suggestions')
                this.#content.view.dispose();
        }
        this.#content = this.#makeContent(kind, tab);
        if (this.#content)
            this.#body.add_child(this.#content.actor);
    }

    #makeContent(kind, tab) {
        if (kind === 'suggestions')
            return {kind, view: this.#suggestions, actor: this.#suggestions.actor};
        if (kind === 'welcome') {
            const view = new Welcome({stores: this.#stores, scope: this.#scope.child()});
            return {kind, view, actor: view.actor};
        }
        if (tab === 'focus') {
            const view = new FocusView({
                focus: this.#stores.focus,
                now: () => this.#stores.now(),
                dir: this.#dir,
                scope: this.#scope.child(),
                hoverLabel: (scope, widget, text) => this.#hoverLabel(scope, widget, text),
                parkFocus: () => this.focusPrompt(),
                hudWidth: () => this.#root.width / St.ThemeContext.get_for_stage(global.stage).scaleFactor,
            });
            return {kind, view, actor: view.actor};
        }
        if (tab === 'caffeine') {
            const view = new CaffeineView({
                caffeine: this.#stores.caffeine,
                now: () => this.#stores.now(),
                dir: this.#dir,
                scope: this.#scope.child(),
                hoverLabel: (scope, widget, text) => this.#hoverLabel(scope, widget, text),
                parkFocus: () => this.focusPrompt(),
            });
            return {kind, view, actor: view.actor};
        }
        if (tab === 'services') {
            const view = new ServicesView({
                services: this.#stores.services,
                now: () => this.#stores.now(),
                dir: this.#dir,
                scope: this.#scope.child(),
                hoverLabel: (scope, widget, text) => this.#hoverLabel(scope, widget, text),
                parkFocus: () => this.focusPrompt(),
                openPreferences: () => this.#stores.openPreferences('services'),
                toast: text => this.#stores.hud.toast(text),
            });
            return {kind, view, actor: view.actor};
        }
        // Chat and Commands come with their slices: an empty body.
        return null;
    }

    /** The footer: a toast, else the hints for this moment; the pills on the right; the tab dots. */
    #syncFooter() {
        const {tab} = this.#stores.hud.state;
        const {toast = null, hints = []} = this.#stores.footer();
        this.#toastBox.visible = toast !== null;
        this.#hints.visible = toast === null;
        if (toast && toast.seq !== this.#toastSeq) {
            this.#toastSeq = toast.seq;
            // Set anew even when the text is the same as the last, so Orca reads it again.
            this.#toast.text = '';
            this.#toast.text = toast.text;
        }
        this.#hints.destroy_all_children();
        for (const hint of hints)
            this.#hints.add_child(W.hint(hint));
        this.#updatePill();
        const activity = this.#stores.tabActivity();
        for (const [id, {dot}] of this.#tabs)
            dot.visible = id !== tab && Boolean(activity[id]);
    }

    #updatePill() {
        const now = this.#stores.now();
        for (const {id, box, label} of this.#pills) {
            const text = this.#stores[id].pill(now);
            box.visible = text !== null;
            if (text)
                label.text = text;
        }
    }

    // ---- Once a second, while the HUD shows ----

    #startTicking() {
        if (this.#ticking)
            return;
        const tick = () => {
            this.#updatePill();
            if (this.#content?.view instanceof TabView)
                this.#content.view.tick();
            // The next tick lands just after the next whole second, when the countdowns change.
            this.#ticking = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000 - (this.#stores.now() % 1000) + 5, () => {
                tick();
                return GLib.SOURCE_REMOVE;
            });
        };
        tick();
    }

    #stopTicking() {
        if (this.#ticking)
            GLib.source_remove(this.#ticking);
        this.#ticking = 0;
    }

    // ---- The prompt ----

    #onInput() {
        const text = this.#prompt.text;
        if (text !== this.#stores.hud.state.input)
            this.#stores.hud.setInput(text);
    }

    #composing() {
        const text = this.#prompt.clutter_text;
        return typeof text.has_preedit === 'function' && text.has_preedit();
    }

    // ---- Keys ----

    /**
     * The HUD's keys while it has the keyboard (UX §6): the core's key map, Tab and Esc.
     * Keys it leaves go to the focused control.
     */
    onKeyPress(event) {
        // While an input method composes text, its keys are its own.
        if (this.#composing())
            return Clutter.EVENT_PROPAGATE;
        const key = event.get_key_symbol();
        const state = event.get_state();
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const hud = this.#stores.hud;
        const name = keyName(event);
        if (name && this.#stores.handleKey({
            key: name,
            ctrl: (state & Clutter.ModifierType.CONTROL_MASK) !== 0,
            alt: (state & Clutter.ModifierType.MOD1_MASK) !== 0,
            shift,
        }, !hud.state.input))
            return Clutter.EVENT_STOP;
        if (key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab) {
            this.#moveFocus(key === Clutter.KEY_ISO_Left_Tab || shift ? -1 : 1);
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Escape) {
            this.#stores.escape();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
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
}
