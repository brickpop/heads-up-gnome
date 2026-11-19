// The Services tab (the Mac's ServicesView; UX §5): the header and its note, then the services
// or the empty state. Each row: the server chip with its status dot, the name, meta and flags,
// the command line, Logs and Start or Stop; the open log drawer under its row. It draws
// ServiceStore.screen(now) and holds no logic.
//
// Log lines arrive often while a service writes, so the view rebuilds only when a row's shape
// changes (its status, buttons, flags, which drawer is open). Otherwise it updates the metas and
// appends the new lines to the drawer in place, keeping its scroll and the keyboard focus.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Strings from '../../../core/strings.js';
import {setPlainText} from '../../markup.js';
import * as C from '../controls.js';
import {TabView} from '../tabView.js';
import * as W from '../widgets.js';

/** The drawer's height (the Mac's 180 pt), in unscaled px. */
const DRAWER_HEIGHT_PX = 180;

/** What makes a row look different, beyond its meta and log lines. */
const shapeOf = screen => JSON.stringify({
    empty: Boolean(screen.empty),
    rows: screen.rows.map(r => [r.id, r.name, r.status, r.commandLine, r.keepsAwake, r.restarts, r.awake,
        r.keepAwakeAway, r.logsOpen, r.logsWarning, r.action.kind, r.action.title, Boolean(r.link), r.metaStyle]),
});

export class ServicesView extends TabView {
    #services;
    #dir;
    #hoverLabel;
    #openPreferences;
    #toast;
    #shape = null;
    /** The parts an update changes in place, by row id: {meta, row, drawer}. */
    #rows = new Map();

    /**
     * @param {object} deps
     * @param {import('../../../core/services.js').ServiceStore} deps.services
     * @param {() => number} deps.now the app's clock (ms)
     * @param {string} deps.dir the extension's folder, for the icons
     * @param {import('../../../core/scope.js').Scope} deps.scope owned by the HUD view
     * @param {() => void} deps.parkFocus puts the keyboard focus on the prompt
     * @param {(scope: object, widget: St.Widget, text: string) => void} deps.hoverLabel
     * @param {() => void} deps.openPreferences the services editor lives there
     * @param {(text: string) => void} deps.toast the HUD's toast
     */
    constructor({services, now, dir, scope, parkFocus, hoverLabel, openPreferences, toast}) {
        super({scope, parkFocus, now, styleClass: 'hu-services'});
        this.#services = services;
        this.#dir = dir;
        this.#hoverLabel = hoverLabel;
        this.#openPreferences = openPreferences;
        this.#toast = toast;
        scope.add(services.on('changed', () => this.tick()));
        this.render();
    }

    screen(now) {
        return this.#services.screen(now);
    }

    build(screen) {
        this.#shape = shapeOf(screen);
        this.#rows.clear();
        const blocks = [this.#header(screen)];
        if (screen.empty)
            blocks.push(this.#empty(screen.empty));
        else
            blocks.push(...screen.rows.map(row => this.#row(row)));
        return blocks;
    }

    /** A store change or the second's tick: in place when only metas and lines moved. */
    update(screen) {
        if (shapeOf(screen) !== this.#shape) {
            this.render();
            return;
        }
        for (const row of screen.rows) {
            const drawn = this.#rows.get(row.id);
            if (!drawn)
                continue;
            if (drawn.meta && row.meta)
                drawn.meta.text = row.meta;
            drawn.text.accessible_name = row.accessibleName;
            drawn.text.get_accessible()?.set_description(row.accessibleValue ?? '');
            if (row.log)
                drawn.drawer?.update(row.log);
        }
    }

    // ---- Pieces ----

    #header(screen) {
        const row = new St.BoxLayout({style_class: 'hu-services-header', x_expand: true});
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        text.add_child(new St.Label({text: screen.label, style_class: 'hu-focus-label hu-ink-3'}));
        if (screen.note)
            text.add_child(new St.Label({text: screen.note, style_class: 'hu-services-note hu-ink-3'}));
        row.add_child(text);
        const edit = W.button({label: screen.edit, kind: 'ghost'});
        edit.focusKey = 'edit';
        edit.y_align = Clutter.ActorAlign.START;
        edit.connect('clicked', () => this.#openPreferences());
        row.add_child(edit);
        return row;
    }

    /** No services yet: a chip, the title and one line, and Add a service…. */
    #empty(empty) {
        const box = new St.BoxLayout({style_class: 'hu-services-empty', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        box.add_child(new St.Icon({gicon: W.icon(this.#dir, 'services'), style_class: 'hu-services-empty-icon hu-ink-3', x_align: Clutter.ActorAlign.CENTER}));
        box.add_child(new St.Label({text: empty.title, style_class: 'hu-services-empty-title', x_align: Clutter.ActorAlign.CENTER}));
        const text = new St.Label({text: empty.text, style_class: 'hu-ink-2', x_align: Clutter.ActorAlign.CENTER});
        text.clutter_text.line_wrap = true;
        box.add_child(text);
        const add = W.button({label: empty.add, kind: 'secondary'});
        add.focusKey = 'add';
        add.x_align = Clutter.ActorAlign.CENTER;
        add.connect('clicked', () => this.#openPreferences());
        box.add_child(add);
        return box;
    }

    /** One service, and its drawer under it while open. */
    #row(row) {
        const box = new St.BoxLayout({
            style_class: `hu-service${row.logsOpen ? ' hu-service-open' : ''}`,
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const line = new St.BoxLayout({style_class: 'hu-service-line', x_expand: true});

        // The chip, name, meta, flags and command line: a running service with a port opens in
        // the browser from a click here.
        const main = new St.Button({style_class: 'hu-service-main', x_expand: true, reactive: Boolean(row.link), can_focus: false});
        const mainBox = new St.BoxLayout({style_class: 'hu-service-main-box', x_expand: true});
        mainBox.add_child(this.#chip(row.status));
        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: row.accessibleName,
        });
        const top = new St.BoxLayout({style_class: 'hu-service-top'});
        const name = new St.Label({text: row.name, style_class: 'hu-service-name'});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        top.add_child(name);
        let meta = null;
        if (row.meta) {
            meta = new St.Label({text: row.meta, style_class: `hu-service-meta hu-tnum ${metaClass(row.metaStyle)}`, y_align: Clutter.ActorAlign.CENTER});
            top.add_child(meta);
        }
        this.#flags(row, top);
        text.add_child(top);
        const command = new St.Label({text: row.commandLine, style_class: 'hu-service-command hu-mono hu-ink-2'});
        command.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(command);
        mainBox.add_child(text);
        main.child = mainBox;
        if (row.link) {
            main.connect('clicked', () => this.#services.openInBrowser(row.id));
            this.#hoverLabel(this.buildScope, main, row.link.help);
            // Orca: the open-in-browser action, from the keyboard, on the port.
            const port = new St.Button({
                style_class: 'hu-service-port hu-accent',
                label: row.link.portLabel,
                can_focus: true,
                accessible_name: row.link.accessibleAction,
            });
            port.focusKey = `port:${row.id}`;
            port.y_align = Clutter.ActorAlign.CENTER;
            port.connect('clicked', () => this.#services.openInBrowser(row.id));
            line.add_child(main);
            line.add_child(port);
        } else {
            line.add_child(main);
        }

        line.add_child(this.#logsToggle(row));
        line.add_child(this.#action(row));
        box.add_child(line);

        let drawer = null;
        if (row.log) {
            drawer = new LogDrawer({
                log: row.log,
                clear: () => this.#services.clearLogs(row.id),
                copyAll: () => this.#copyLogs(row.id),
                focusKey: `clear:${row.id}`,
            });
            box.add_child(drawer.actor);
        }
        this.#rows.set(row.id, {meta, text, drawer});
        return box;
    }

    /** Copy All: the whole log, not only the lines shown, then the toast. */
    #copyLogs(id) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this.#services.logText(id));
        this.#toast(Strings.Common.copied);
    }

    /** The server chip, with the status dot at its corner: green, an accent ring, gray, or a red ×. */
    #chip(status) {
        const chip = new St.Widget({style_class: 'hu-chip hu-service-chip', layout_manager: new Clutter.BinLayout()});
        chip.add_child(new St.Icon({gicon: W.icon(this.#dir, 'services'), x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        const dot = status === 'failed'
            ? new St.Icon({gicon: W.icon(this.#dir, 'close'), style_class: 'hu-service-dot-failed hu-danger'})
            : new St.Widget({style_class: `hu-service-dot hu-service-dot-${status}`});
        dot.x_align = Clutter.ActorAlign.END;
        dot.y_align = Clutter.ActorAlign.END;
        chip.add_child(dot);
        return chip;
    }

    /** The cup (keeps awake) and the restart arrow after the meta, each with its hover label. */
    #flags(row, box) {
        if (row.keepsAwake) {
            const style = row.awake === 'refused' ? 'hu-warn' : row.keepAwakeAway ? 'hu-ink-3' : 'hu-ink-2';
            const cup = new St.Icon({gicon: W.icon(this.#dir, 'cup'), style_class: `hu-service-flag ${style}`, reactive: true, track_hover: true});
            this.#hoverLabel(this.buildScope, cup, row.keepAwakeHelp);
            box.add_child(cup);
        }
        if (row.restarts) {
            const restart = new St.Icon({gicon: W.icon(this.#dir, 'restart'), style_class: 'hu-service-flag hu-ink-2', reactive: true, track_hover: true});
            this.#hoverLabel(this.buildScope, restart, Strings.Services.restartsHelp);
            box.add_child(restart);
        }
    }

    /** Logs: an icon-only toggle, on while the drawer is open, with a warn dot while the port is silent. */
    #logsToggle(row) {
        const icon = new St.Widget({layout_manager: new Clutter.BinLayout()});
        icon.add_child(new St.Icon({gicon: W.icon(this.#dir, 'list'), x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        if (row.logsWarning)
            icon.add_child(new St.Widget({style_class: 'hu-dot hu-logs-warning', x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START}));
        const toggle = new St.Button({
            style_class: 'hu-button hu-button-ghost hu-button-icon',
            child: icon,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_role: Atk.Role.TOGGLE_BUTTON,
            accessible_name: Strings.Services.logs,
        });
        if (row.logsOpen) {
            toggle.add_style_pseudo_class('checked');
            toggle.add_accessible_state(Atk.StateType.CHECKED);
        }
        toggle.focusKey = `logs:${row.id}`;
        toggle.connect('clicked', () => this.#services.toggleLogs(row.id));
        this.#hoverLabel(this.buildScope, toggle, Strings.Services.logsHelp(row.logsOpen));
        return toggle;
    }

    /** Start (primary) or Stop, or Edit… for a hand-edited service that can't start. */
    #action(row) {
        const {action} = row;
        const button = action.kind === 'edit'
            ? C.actionButton({title: action.title, kind: 'secondary', focusKey: `action:${row.id}`, run: () => this.#openPreferences()})
            : C.actionButton({
                title: action.title,
                kind: action.primary ? 'primary' : 'secondary',
                gicon: W.icon(this.#dir, action.glyph),
                focusKey: `action:${row.id}`,
                run: () => this.#services.toggleRun(row.id),
            });
        button.add_style_class_name('hu-service-action');
        button.y_align = Clutter.ActorAlign.CENTER;
        return button;
    }
}

/** The meta's colour: accent while running, warn for a silent port or a restart, else secondary. */
function metaClass(style) {
    return {accent: 'hu-accent', warn: 'hu-warn'}[style] ?? 'hu-ink-2';
}

/**
 * The log drawer: 180 px of mono text on the code background, newest at the bottom, then Copy
 * All and Clear. The shown lines are one plain-text label, cut to their end by markup.js, with
 * "Too long to show in full." above them when cut (UX §12a); Copy All copies the whole log.
 * It follows the bottom unless you have scrolled up.
 */
class LogDrawer {
    #label;
    #tooLong;
    #scroll;
    #shown = null;
    /** The handler waiting for the next layout to scroll to the bottom, or 0. */
    #pendingScroll = 0;

    constructor({log, clear, copyAll, focusKey}) {
        this.actor = new St.BoxLayout({style_class: 'hu-drawer hu-code', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.#tooLong = new St.Label({text: Strings.Common.tooLong, style_class: 'hu-drawer-cut hu-ink-3', visible: false});
        this.actor.add_child(this.#tooLong);
        this.#label = new St.Label({style_class: 'hu-drawer-text hu-mono', x_expand: true});
        this.#label.clutter_text.line_wrap = true;
        this.#label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.#scroll = new St.ScrollView({
            child: this.#label,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
            style: `height: ${DRAWER_HEIGHT_PX}px;`,
        });
        this.actor.add_child(this.#scroll);
        const buttons = new St.BoxLayout({style_class: 'hu-drawer-buttons', x_align: Clutter.ActorAlign.END});
        const copy = W.button({label: Strings.Common.copyAll, kind: 'ghost'});
        copy.focusKey = `${focusKey}:copy`;
        copy.connect('clicked', () => copyAll());
        const clearButton = W.button({label: log.clear, kind: 'ghost'});
        clearButton.focusKey = focusKey;
        clearButton.connect('clicked', () => clear());
        buttons.add_child(copy);
        buttons.add_child(clearButton);
        this.actor.add_child(buttons);
        this.actor.connect('destroy', () => this.#cancelScroll());
        this.update(log);
    }

    /** The lines shown now; the view stays at the bottom while you're there. */
    update(log) {
        const text = log.emptyText ?? log.lines.map(line => `${line.time}  ${line.text}`).join('\n');
        if (text === this.#shown)
            return;
        // A scroll still waiting from the last update goes: it must not jump after the user
        // scrolled up in between.
        this.#cancelScroll();
        const first = this.#shown === null;
        const atBottom = first || this.#atBottom();
        this.#shown = text;
        if (log.emptyText)
            this.#label.add_style_class_name('hu-ink-2');
        else
            this.#label.remove_style_class_name('hu-ink-2');
        this.#tooLong.visible = setPlainText(this.#label, text);
        if (atBottom)
            this.#scrollToBottom();
    }

    #atBottom() {
        const adjustment = this.#scroll.vadjustment;
        return adjustment.value + adjustment.page_size >= adjustment.upper - 2;
    }

    /** At the next layout change, which the new text causes; cancelled by the next update. */
    #scrollToBottom() {
        const adjustment = this.#scroll.vadjustment;
        this.#pendingScroll = adjustment.connect('changed', () => {
            this.#cancelScroll();
            adjustment.value = adjustment.upper - adjustment.page_size;
        });
    }

    #cancelScroll() {
        if (this.#pendingScroll)
            this.#scroll.vadjustment.disconnect(this.#pendingScroll);
        this.#pendingScroll = 0;
    }
}
