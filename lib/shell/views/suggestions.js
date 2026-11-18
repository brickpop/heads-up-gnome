// The suggestion rows under the prompt (the Mac's SuggestionList; Action autocomplete spec).
// It draws HudStore's `suggestions` and `selected`; the core decides both. A pointer that
// moves over a row selects it, and a click runs it.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Strings from '../../core/strings.js';
import * as W from './widgets.js';

/** The tab icons for "Go to <tab>", whose glyph is the tab's name. */
const GLYPH_ICONS = {chat: 'chat', focus: 'timer', caffeine: 'cup', services: 'services', commands: 'terminal'};
/** Past this height the list scrolls (the Mac's 440 pt). */
const MAX_HEIGHT_PX = 440;

export class Suggestions {
    #dir;
    #hud;
    #list;
    /** The rows drawn, so a new state redraws only when they change. */
    #rows = null;
    /** The drawn rows by index: {button, box, keycap}, or null for a line that can't be selected. */
    #drawn = [];
    #selected = null;

    /**
     * @param {object} deps
     * @param {string} deps.dir the extension's folder, for the icons
     * @param {import('../../core/hud.js').HudStore} deps.hud
     */
    constructor({dir, hud}) {
        this.#dir = dir;
        this.#hud = hud;
        this.#list = new St.BoxLayout({style_class: 'hu-suggestions', orientation: Clutter.Orientation.VERTICAL});
        this.actor = new St.ScrollView({
            child: this.#list,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            style: `max-height: ${MAX_HEIGHT_PX}px;`,
            accessible_role: Atk.Role.LIST,
            accessible_name: Strings.Suggestions.accessibleName,
        });
    }

    /** Draws the store's rows and selection. */
    sync() {
        const {suggestions, selected} = this.#hud.state;
        if (suggestions !== this.#rows) {
            this.#rows = suggestions;
            this.#draw();
            this.#selected = null;
        }
        if (selected !== this.#selected) {
            this.#mark(this.#selected, false);
            this.#selected = selected;
            this.#mark(selected, true);
            // Keep it in view; Orca hears the new row through its selected state.
            const button = this.#drawn[selected]?.button;
            if (button)
                this.actor.vadjustment.clamp(button.y, button.y + button.height);
        }
    }

    /** The selected look: a fill, the Enter keycap, and the state Orca reads. */
    #mark(index, selected) {
        const drawn = index === null ? null : this.#drawn[index];
        if (!drawn)
            return;
        drawn.keycap.visible = selected;
        if (selected) {
            drawn.box.add_style_pseudo_class('selected');
            drawn.button.add_accessible_state(Atk.StateType.SELECTED);
        } else {
            drawn.box.remove_style_pseudo_class('selected');
            drawn.button.remove_accessible_state(Atk.StateType.SELECTED);
        }
    }

    #draw() {
        this.#list.destroy_all_children();
        const count = this.#rows.filter(row => row.kind !== 'noMatch').length;
        let position = 0;
        this.#drawn = this.#rows.map((row, index) => {
            if (row.kind === 'noMatch') {
                this.#list.add_child(new St.Label({text: row.text, style_class: 'hu-suggestion-none hu-ink-2'}));
                return null;
            }
            position++;
            const drawn = this.#row(row, index, position, count);
            this.#list.add_child(drawn.button);
            return drawn;
        });
    }

    /** One row: icon chip, title, mono subtitle and kind; the selected one has a fill and an Enter keycap. */
    #row(row, index, position, count) {
        const {title, subtitle, kind, glyph} = row.kind === 'ask'
            ? {title: row.title, subtitle: row.subtitle, kind: 'chat', glyph: 'sparkle'}
            : row.action;
        const kindLabel = Strings.ActionKinds.label(kind) ?? '';

        const box = new St.BoxLayout({style_class: 'hu-row hu-suggestion', x_expand: true});
        box.add_child(new St.Bin({
            style_class: 'hu-chip',
            child: new St.Icon({gicon: W.icon(this.#dir, GLYPH_ICONS[glyph] ?? glyph)}),
        }));
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        for (const [value, style] of [[title, 'hu-suggestion-title'], [subtitle, 'hu-suggestion-subtitle hu-mono hu-ink-2']]) {
            const label = new St.Label({text: value, style_class: style});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(label);
        }
        box.add_child(text);
        box.add_child(new St.Label({text: kindLabel, style_class: 'hu-suggestion-kind hu-ink-3', y_align: Clutter.ActorAlign.CENTER}));
        const keycap = new St.Label({text: Strings.Suggestions.runKey, style_class: 'hu-keycap', y_align: Clutter.ActorAlign.CENTER, visible: false});
        box.add_child(keycap);

        const button = new St.Button({
            child: box,
            x_expand: true,
            accessible_role: Atk.Role.LIST_ITEM,
            accessible_name: Strings.Suggestions.accessibleRow(title, kindLabel, position, count),
        });
        button.connect('clicked', () => this.#hud.runRow(index));
        // Only a pointer that moves selects: rows that appear under a resting pointer don't
        // take the selection from the keyboard.
        button.connect('motion-event', () => {
            if (this.#hud.state.selected !== index)
                this.#hud.selectRow(index);
            return Clutter.EVENT_PROPAGATE;
        });
        return {button, box, keycap};
    }
}
