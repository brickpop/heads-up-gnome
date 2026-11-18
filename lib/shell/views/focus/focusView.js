// The Focus tab (the Mac's FocusView and its phase views; UX §5, §6). It draws
// FocusStore.screen(now) and holds no logic: every string and choice comes from there.
//
// It rebuilds when the store changes (a click, a key, an end) and, while the HUD shows,
// updates only the text that time changes once a second. A rebuild gives the keyboard focus
// back to the control that had it, by its focusKey.

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Strings from '../../../core/strings.js';
import * as C from '../controls.js';
import * as W from '../widgets.js';

const PRIMARY_KEYS = () => Strings.Focus.primaryShortcut;
/** The break options' grid: as many columns of at least 150 px as fit (the Mac's adaptive grid). */
const OPTION_MIN_PX = 150;
const CARD_GAP_PX = 10;
const SIDE_PADDING_PX = 24;

/** Columns that fit in the HUD's width (in unscaled px): max(1, floor((width + gap) / (min + gap))). */
function optionColumns(hudWidth) {
    const available = hudWidth - 2 * SIDE_PADDING_PX;
    return Math.max(1, Math.floor((available + CARD_GAP_PX) / (OPTION_MIN_PX + CARD_GAP_PX)));
}

export class FocusView {
    #focus;
    #now;
    #dir;
    #scope;
    #hoverLabel;
    #parkFocus;
    #hudWidth;
    /** Owns what one rebuild connects (hover labels); disposed by the next rebuild. */
    #renderScope = null;
    #kind = null;
    /** The labels a tick updates: {timer, subtitle, title, progress}. */
    #live = {};

    /**
     * @param {object} deps
     * @param {import('../../../core/focus.js').FocusStore} deps.focus
     * @param {() => number} deps.now the app's clock (ms)
     * @param {string} deps.dir the extension's folder, for the icons
     * @param {import('../../../core/scope.js').Scope} deps.scope owned by the HUD view
     * @param {(scope: object, widget: St.Widget, text: string) => void} deps.hoverLabel
     * @param {() => void} deps.parkFocus puts the keyboard focus on the prompt
     * @param {() => number} deps.hudWidth the HUD's width in unscaled px (set when it is placed)
     */
    constructor({focus, now, dir, scope, hoverLabel, parkFocus, hudWidth}) {
        this.#hudWidth = hudWidth;
        this.#focus = focus;
        this.#now = now;
        this.#dir = dir;
        this.#scope = scope;
        this.#hoverLabel = hoverLabel;
        this.#parkFocus = parkFocus;
        this.actor = new St.BoxLayout({style_class: 'hu-focus', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        scope.add(focus.on('changed', () => this.render()));
        this.render();
    }

    /** Rebuilds from the store, keeping the keyboard focus on the same control. */
    render() {
        const hadFocus = this.actor.contains(global.stage.key_focus);
        const focusKey = this.#focusedKey();
        // Off the controls before they go: a destroyed focused actor leaves the focus on the
        // stage, which the HUD would read as the shell taking its keyboard.
        if (hadFocus)
            this.#parkFocus();
        const screen = this.#focus.screen(this.#now());
        this.#renderScope?.dispose();
        this.#renderScope = this.#scope.child();
        this.actor.destroy_all_children();
        this.#live = {};
        this.#kind = screen.kind;
        for (const child of this.#build(screen))
            this.actor.add_child(child);
        if (focusKey)
            this.#refocus(focusKey);
    }

    /** Once a second while the HUD shows: the time-driven text only, or a rebuild if the phase moved. */
    tick() {
        const screen = this.#focus.screen(this.#now());
        if (screen.kind !== this.#kind) {
            this.render();
            return;
        }
        const live = this.#live;
        if (live.timer) {
            live.timer.text = screen.timer;
            if (screen.timerAccessible)
                live.timer.accessible_name = screen.timerAccessible;
        }
        if (live.subtitle)
            live.subtitle.text = screen.subtitle;
        if (live.title)
            live.title.text = screen.title;
        live.progress?.update(screen.progress);
    }

    dispose() {
        this.#scope.dispose();
        this.actor.destroy();
    }

    // ---- The phases ----

    #build(screen) {
        switch (screen.kind) {
        case 'idle': return this.#idle(screen);
        case 'running': return this.#running(screen);
        case 'breakPrompt': return this.#breakPrompt(screen);
        case 'backPrompt': return this.#backPrompt(screen);
        default: return this.#snoozed(screen);
        }
    }

    /** The selected length as a big timer, today's stats, the length cards, the breaks offered, Start. */
    #idle(screen) {
        const top = new St.BoxLayout({x_expand: true});
        top.add_child(this.#labelOver(screen.label, this.#timer(screen.timer)));
        top.add_child(new St.Widget({x_expand: true}));
        top.add_child(this.#stats(screen.today));

        const bottom = new St.BoxLayout({x_expand: true});
        const offer = new St.Label({text: screen.breaksOffer, style_class: 'hu-focus-hint hu-ink-2', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        offer.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        bottom.add_child(offer);
        bottom.add_child(this.#primary(screen.start, 'primary', 'play', () => this.#focus.start()));
        return [top, this.#lengthCards(screen.lengths, minutes => this.#focus.setFocusLength(minutes)), bottom];
    }

    /** A focus or a break, running or paused: the countdown, the bar, [Pause] [Stop now] … [Take a break]. */
    #running(screen) {
        const timer = this.#timer(screen.timer);
        timer.accessible_name = screen.timerAccessible;
        const subtitle = this.#stats(screen.subtitle);
        const head = this.#labelOver(screen.label, timer);
        head.add_child(subtitle);
        this.#live.subtitle = subtitle;

        const progress = C.progressBar(screen.label);
        progress.update(screen.progress);
        this.#live.progress = progress;

        const buttons = new St.BoxLayout({style_class: 'hu-focus-buttons', x_expand: true});
        buttons.add_child(this.#button(screen.pauseTitle, 'secondary', screen.pauseGlyph, 'pause', () => this.#focus.togglePause()));
        if (screen.stop)
            buttons.add_child(this.#runButton(screen.stop));
        buttons.add_child(new St.Widget({x_expand: true}));
        buttons.add_child(this.#runButton(screen.end));
        return [head, progress.actor, buttons];
    }

    /** "Time for a break": the options, the Length group, then Snooze … Start break. */
    #breakPrompt(screen) {
        const head = this.#labelOver(screen.label, this.#title(screen.title));
        const options = C.cardGroup({
            items: screen.options,
            columns: optionColumns(this.#hudWidth()),
            focusKey: 'options',
            select: option => this.#focus.selectActivity(option.id),
            content: option => {
                const box = new St.BoxLayout({style_class: 'hu-option'});
                const chip = new St.Bin({style_class: 'hu-chip hu-option-chip', child: new St.Icon({gicon: W.icon(this.#dir, option.glyph)})});
                box.add_child(chip);
                const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
                const name = new St.Label({text: option.label, style_class: 'hu-option-label'});
                name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                text.add_child(name);
                text.add_child(new St.Label({text: option.length, style_class: 'hu-focus-hint hu-ink-2'}));
                box.add_child(text);
                return box;
            },
        });
        const length = C.segmentGroup({
            gicon: W.icon(this.#dir, 'hourglass'),
            label: Strings.Focus.length,
            accessibleName: Strings.Focus.lengthGroupAccessible,
            segments: screen.lengths,
            // A click selects the length; it doesn't start the break.
            select: minutes => this.#focus.setBreakLength(minutes),
            act: minutes => this.#focus.setBreakLength(minutes),
            focusKey: 'length',
            hoverLabel: (widget, text) => this.#hoverLabel(this.#renderScope, widget, text),
        });
        length.x_align = Clutter.ActorAlign.END;
        const actions = this.#promptActions(screen.snooze,
            this.#primary(screen.startBreak, 'amber', null, () => this.#focus.startBreak()));
        const lower = new St.BoxLayout({style_class: 'hu-focus-buttons', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        lower.add_child(length);
        lower.add_child(actions);
        return [head, options, lower];
    }

    /** "Ready to get back to it?": today's stats, the length cards, then Snooze … Start focus. */
    #backPrompt(screen) {
        const head = this.#labelOver(screen.label, this.#title(screen.title));
        head.add_child(this.#stats(screen.today));
        const cards = this.#lengthCards(screen.lengths, minutes => this.#focus.setNextFocusLength(minutes));
        const actions = this.#promptActions(screen.snooze,
            this.#primary(screen.start, 'primary', 'play', () => this.#focus.start()));
        return [head, cards, actions];
    }

    /** Snoozed: when the prompt comes back, and Show now. */
    #snoozed(screen) {
        const title = this.#title(screen.title, 'hu-focus-title-small');
        this.#live.title = title;
        const show = this.#primary(screen.showNow, 'secondary', null, () => this.#focus.showNow());
        show.x_align = Clutter.ActorAlign.START;
        return [this.#labelOver(screen.label, title), show];
    }

    // ---- Pieces ----

    #labelOver(label, below) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'hu-focus-head'});
        box.add_child(new St.Label({text: label, style_class: 'hu-focus-label hu-ink-3'}));
        box.add_child(below);
        return box;
    }

    #timer(text) {
        const timer = new St.Label({text, style_class: 'hu-timer'});
        this.#live.timer = timer;
        return timer;
    }

    #title(text, extra = '') {
        return new St.Label({text, style_class: `hu-focus-title ${extra}`.trim()});
    }

    #stats(text) {
        return new St.Label({text, style_class: 'hu-focus-stats hu-ink-2', y_align: Clutter.ActorAlign.END});
    }

    #lengthCards(lengths, select) {
        return C.cardGroup({
            items: lengths,
            focusKey: 'lengths',
            select: card => select(card.minutes),
            content: card => {
                const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
                box.add_child(new St.Label({text: card.title, style_class: 'hu-card-number'}));
                box.add_child(new St.Label({text: card.hint, style_class: 'hu-focus-hint hu-ink-2'}));
                return box;
            },
        });
    }

    /** The snooze group on both prompts, then the prompt's primary button on the right. */
    #promptActions(snooze, primary) {
        const row = new St.BoxLayout({x_expand: true});
        row.add_child(C.segmentGroup({
            gicon: W.icon(this.#dir, 'bell'),
            label: snooze.label,
            segments: snooze.choices,
            select: minutes => this.#focus.selectSnooze(minutes),
            act: minutes => this.#focus.snooze(minutes),
            action: {title: snooze.stopNow, help: snooze.stopNowHelp, run: () => this.#focus.doneForNow()},
            focusKey: 'snooze',
            hoverLabel: (widget, text) => this.#hoverLabel(this.#renderScope, widget, text),
        }));
        row.add_child(new St.Widget({x_expand: true}));
        row.add_child(primary);
        return row;
    }

    /** The tab's primary button: it shows Ctrl Enter, which runs it from the prompt. */
    #primary(title, kind, glyph, run) {
        return C.actionButton({
            title, kind, run,
            gicon: glyph ? W.icon(this.#dir, glyph) : null,
            keys: PRIMARY_KEYS(),
            hint: Strings.Focus.primaryShortcutHint,
            focusKey: 'primary',
        });
    }

    #button(title, kind, glyph, focusKey, run) {
        return C.actionButton({title, kind, run, gicon: W.icon(this.#dir, glyph), focusKey});
    }

    /** Stop now in red (it loses the session); Take a break and Skip break in the warn colour. */
    #runButton({action, title, glyph}) {
        return this.#button(title, action === 'stopNow' ? 'destructive' : 'break', glyph, action,
            () => this.#focus.run(action));
    }

    // ---- Keyboard focus across rebuilds ----

    #focusedKey() {
        let actor = global.stage.key_focus;
        while (actor && actor !== this.actor) {
            if (actor.focusKey)
                return actor.focusKey;
            actor = actor.get_parent();
        }
        return null;
    }

    /** The control with `key` that can take focus (in a group, the selected item). */
    #refocus(key) {
        const find = actor => {
            for (const child of actor.get_children()) {
                if (child.focusKey === key && child.can_focus)
                    return child;
                const found = find(child);
                if (found)
                    return found;
            }
            return null;
        };
        find(this.actor)?.grab_key_focus();
    }
}
