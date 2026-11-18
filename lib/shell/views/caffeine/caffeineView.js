// The Caffeine tab (the Mac's CaffeineView; UX §5): the header with its chip and switch, the
// note when GNOME refused, the lines about services, the extend row, the duration cards and
// the options. It draws CaffeineStore.screen(now) and holds no logic.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as C from '../controls.js';
import {TabView} from '../tabView.js';
import * as W from '../widgets.js';

export class CaffeineView extends TabView {
    #caffeine;
    #dir;
    #hoverLabel;
    /** The subtitle a tick updates (the time left). */
    #subtitle = null;

    /**
     * @param {object} deps
     * @param {import('../../../core/caffeine.js').CaffeineStore} deps.caffeine
     * @param {() => number} deps.now the app's clock (ms)
     * @param {string} deps.dir the extension's folder, for the icons
     * @param {import('../../../core/scope.js').Scope} deps.scope owned by the HUD view
     * @param {() => void} deps.parkFocus puts the keyboard focus on the prompt
     * @param {(scope: object, widget: St.Widget, text: string) => void} deps.hoverLabel
     */
    constructor({caffeine, now, dir, scope, parkFocus, hoverLabel}) {
        super({scope, parkFocus, now, styleClass: 'hu-focus hu-caffeine'});
        this.#caffeine = caffeine;
        this.#dir = dir;
        this.#hoverLabel = hoverLabel;
        scope.add(caffeine.on('changed', () => this.render()));
        this.render();
    }

    screen(now) {
        return this.#caffeine.screen(now);
    }

    build(screen) {
        const top = new St.BoxLayout({style_class: 'hu-caffeine-top', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        top.add_child(this.#header(screen.header));
        if (screen.holdNote)
            top.add_child(this.#holdNote(screen.holdNote));
        if (screen.heldLine)
            top.add_child(this.#line(screen.heldLine, 'hu-ink-2'));
        if (screen.refusedLine)
            top.add_child(this.#line(screen.refusedLine, 'hu-warn'));
        const blocks = [top];
        if (screen.extend)
            blocks.push(this.#extend(screen.extend));
        blocks.push(this.#durations(screen));
        blocks.push(this.#options(screen.options));
        return blocks;
    }

    /** Once a second: the time left in the subtitle. */
    update(screen) {
        if (this.#subtitle)
            this.#subtitle.text = screen.header.subtitle;
    }

    /** The chip (accent while it holds, with a pause or server badge), title, subtitle and the switch. */
    #header(header) {
        const row = new St.BoxLayout({style_class: 'hu-caffeine-header', x_expand: true});
        const chip = new St.Widget({
            style_class: `hu-caffeine-chip${header.chipAccent ? ' hu-caffeine-chip-on' : ''}`,
            layout_manager: new Clutter.BinLayout(),
        });
        chip.add_child(new St.Icon({gicon: W.icon(this.#dir, 'cup'), x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        // Pausing on battery is the user's option working, so the badge is secondary, not warn.
        // The server badge says a service, not Caffeine, keeps the computer awake.
        const badge = header.pauseBadge ? 'pause' : header.serverBadge ? 'services' : null;
        if (badge) {
            chip.add_child(new St.Icon({
                gicon: W.icon(this.#dir, badge),
                style_class: 'hu-caffeine-badge',
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.END,
            }));
        }
        row.add_child(chip);

        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        text.add_child(new St.Label({text: header.title, style_class: 'hu-caffeine-title'}));
        this.#subtitle = new St.Label({text: header.subtitle, style_class: 'hu-focus-stats hu-tnum hu-ink-2'});
        text.add_child(this.#subtitle);
        row.add_child(text);
        row.add_child(C.toggleSwitch({
            label: header.switchLabel,
            on: header.isOn,
            focusKey: 'switch',
            toggle: () => this.#caffeine.toggle(),
        }));
        return row;
    }

    /** GNOME refused to keep the computer awake: a red note and Try Again. */
    #holdNote(note) {
        const row = new St.BoxLayout({style_class: 'hu-caffeine-indent hu-caffeine-note', x_expand: true});
        const text = new St.Label({text: note.text, style_class: 'hu-danger hu-focus-hint', y_align: Clutter.ActorAlign.CENTER});
        text.clutter_text.line_wrap = true;
        row.add_child(text);
        const retry = W.button({label: note.tryAgain, kind: 'ghost'});
        retry.focusKey = 'retry';
        retry.connect('clicked', () => this.#caffeine.retry());
        row.add_child(retry);
        return row;
    }

    /** A line under the header, starting under the title rather than the chip. */
    #line(text, style) {
        const label = new St.Label({text, style_class: `hu-caffeine-indent hu-focus-hint ${style}`});
        label.clutter_text.line_wrap = true;
        return label;
    }

    /** "Need a bit longer?" with +10 min and +1 h, on the raised fill. */
    #extend(extend) {
        const row = new St.BoxLayout({style_class: 'hu-caffeine-extend', x_expand: true});
        row.add_child(new St.Label({text: extend.prompt, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        for (const button of extend.buttons) {
            const widget = W.button({label: button.title, kind: 'secondary'});
            widget.focusKey = `extend:${button.minutes}`;
            widget.connect('clicked', () => this.#caffeine.extend(button.minutes));
            row.add_child(widget);
        }
        return row;
    }

    /** "Keep awake for": the four cards. A click turns Caffeine on with one; the keyboard only picks it. */
    #durations(screen) {
        const box = new St.BoxLayout({style_class: 'hu-caffeine-durations', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        box.add_child(new St.Label({text: screen.durationsLabel, style_class: 'hu-focus-label hu-ink-3'}));
        box.add_child(C.cardGroup({
            items: screen.durations,
            focusKey: 'durations',
            select: card => this.#caffeine.chooseDuration(card.duration),
            activate: card => this.#caffeine.selectDuration(card.duration),
            content: card => new St.Label({text: card.title, style_class: 'hu-caffeine-card-title'}),
        }));
        return box;
    }

    /** The options: a list of rows, each a title, its help and a small switch. */
    #options(options) {
        const list = new St.BoxLayout({style_class: 'hu-card hu-settings-list', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        options.forEach((option, index) => {
            if (index > 0)
                list.add_child(new St.Widget({style_class: 'hu-hairline'}));
            const row = new St.BoxLayout({style_class: 'hu-settings-row', x_expand: true});
            const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            text.add_child(new St.Label({text: option.title, style_class: 'hu-settings-title'}));
            text.add_child(new St.Label({text: option.help, style_class: 'hu-focus-hint hu-ink-2'}));
            row.add_child(text);
            const toggle = C.toggleSwitch({
                label: option.title,
                on: option.isOn,
                // The last of the two hold options can't be turned off: its help says why.
                enabled: option.enabled,
                disabledHelp: option.disabledHelp,
                hoverLabel: (widget, text) => this.#hoverLabel(this.buildScope, widget, text),
                focusKey: `option:${option.option}`,
                toggle: () => this.#caffeine.setOption(option.option, !option.isOn),
            });
            row.add_child(toggle);
            list.add_child(row);
        });
        return list;
    }
}
