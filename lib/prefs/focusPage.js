// Preferences → Focus (the Mac's Focus & breaks section; UX §9). Writes go through the core's
// FocusSettingsEditor.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {BREAK_LENGTHS, FOCUS_LENGTHS, SNOOZE_LENGTHS} from '../core/focusSettings.js';
import * as Strings from '../core/strings.js';

/** A toggle group (UX §9: 2–3 short options) of minute lengths, as a row's suffix. */
function lengthToggles(lengths, label, selected, select) {
    const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
    for (const minutes of lengths)
        group.add(new Adw.Toggle({name: String(minutes), label: label(minutes)}));
    group.active_name = String(selected);
    group.connect('notify::active-name', () => select(Number(group.active_name)));
    return group;
}

/** Preferences → Focus (the Mac's Focus & breaks section; UX §9). */
export class FocusPage {
    #editor;
    #focusLength;
    #snoozeLength;
    #openHud;
    #autoStart;
    #options;
    #optionRows = [];
    /** The options the rows show, to rebuild them only when the options change. */
    #shownOptions = null;
    #addRow;
    /** True while the page writes the store's values into its controls, so they don't write back. */
    #syncing = false;

    constructor({editor, store, scope}) {
        this.#editor = editor;
        const P = Strings.FocusPrefs;
        this.page = new Adw.PreferencesPage({name: 'focus', title: Strings.Tabs.title('focus'), icon_name: 'timer-symbolic'});

        const timer = new Adw.PreferencesGroup({title: P.title});
        this.page.add(timer);
        this.#focusLength = lengthToggles(FOCUS_LENGTHS, P.minutes, editor.settings.focusLength,
            minutes => this.#write(() => editor.setFocusLength(minutes)));
        timer.add(this.#suffixRow(P.focusLength, this.#focusLength));
        this.#snoozeLength = lengthToggles(SNOOZE_LENGTHS, P.minutesShort, editor.settings.snoozeMinutes,
            minutes => this.#write(() => editor.setSnoozeMinutes(minutes)));
        timer.add(this.#suffixRow(P.snoozeLength, this.#snoozeLength));
        this.#openHud = new Adw.SwitchRow({title: P.openHud, subtitle: P.openHudHelp, use_markup: false});
        this.#openHud.connect('notify::active', () => this.#write(() => editor.setOpenHudOnEnd(this.#openHud.active)));
        timer.add(this.#openHud);
        this.#autoStart = new Adw.SwitchRow({title: P.autoStart, subtitle: P.autoStartHelp, use_markup: false});
        this.#autoStart.connect('notify::active', () => this.#write(() => editor.setAutoStartNextFocus(this.#autoStart.active)));
        timer.add(this.#autoStart);

        // Break options: one row each with its length and Remove, then the row that adds one.
        this.#options = new Adw.PreferencesGroup({title: P.breakOptions, description: P.intro});
        this.page.add(this.#options);
        this.#addRow = new Adw.EntryRow({title: P.addPlaceholder, show_apply_button: true, use_markup: false});
        this.#addRow.connect('apply', () => {
            editor.addBreakOption(this.#addRow.text);
            this.#addRow.text = '';
        });

        scope.add(store.on('changed', () => this.#sync()));
        this.#sync();
    }

    #suffixRow(title, suffix) {
        const row = new Adw.ActionRow({title, use_markup: false});
        row.add_suffix(suffix);
        return row;
    }

    /** A change from a control: written unless it is the page syncing from the store. */
    #write(fn) {
        if (!this.#syncing)
            fn();
    }

    #sync() {
        const settings = this.#editor.settings;
        this.#syncing = true;
        this.#focusLength.active_name = String(settings.focusLength);
        this.#snoozeLength.active_name = String(settings.snoozeMinutes);
        this.#openHud.active = settings.openHudOnEnd;
        this.#autoStart.active = settings.autoStartNextFocus;
        this.#syncOptions(settings.breakOptions);
        this.#syncing = false;
    }

    /** Rebuilds the option rows; the add row stays last (and keeps what is being typed). */
    #syncOptions(options) {
        const shown = JSON.stringify(options);
        if (shown === this.#shownOptions)
            return;
        this.#shownOptions = shown;
        const P = Strings.FocusPrefs;
        for (const row of this.#optionRows)
            this.#options.remove(row);
        if (this.#addRow.get_parent())
            this.#options.remove(this.#addRow);
        const canRemove = this.#editor.canRemoveBreakOption;
        this.#optionRows = options.map(option => {
            const row = new Adw.ComboRow({
                title: option.label,
                use_markup: false,
                model: Gtk.StringList.new(BREAK_LENGTHS.map(P.minutes)),
                selected: Math.max(0, BREAK_LENGTHS.indexOf(option.minutes)),
            });
            row.add_prefix(new Gtk.Image({icon_name: `${option.icon}-symbolic`}));
            row.connect('notify::selected', () => this.#write(() =>
                this.#editor.setBreakOptionLength(option.id, BREAK_LENGTHS[row.selected])));
            const remove = new Gtk.Button({
                icon_name: 'close-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                sensitive: canRemove,
                // There is always one option to pick.
                tooltip_text: canRemove ? P.remove : P.keepOne,
            });
            remove.update_property([Gtk.AccessibleProperty.LABEL], [P.removeOption(option.label)]);
            remove.connect('clicked', () => this.#editor.removeBreakOption(option.id));
            row.add_suffix(remove);
            this.#options.add(row);
            return row;
        });
        this.#options.add(this.#addRow);
    }
}
