// HeadsUp's preferences window (UX §7, §9): the pages that have something to set so far
// (no empty pages), Focus and General. Every write goes through SettingsStore (ADR-002 §4),
// Focus's through its FocusSettingsEditor; the shell does the rest when it sees the change.
// Prefs never touch lib/shell.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {BREAK_LENGTHS, FOCUS_LENGTHS, FocusSettingsEditor, SNOOZE_LENGTHS} from './lib/core/focusSettings.js';
import {Scope} from './lib/core/scope.js';
import {SettingsStore} from './lib/core/settings.js';
import {recorderProblem} from './lib/core/shortcutClaim.js';
import * as Strings from './lib/core/strings.js';
import {gnomeKeys as makeGnomeKeys, keyValues} from './lib/adapters/gsettings.js';

const STATE_SCHEMA = 'org.gnome.shell.extensions.headsup.state';
const DEFAULT_SHORTCUT = '<Super>space';
const APPEARANCES = ['system', 'light', 'dark'];
/** The statuses in which the Wake Shortcut row shows its warning icon (UX §7). */
const PROBLEM_STATUSES = new Set(['layouts', 'in-use', 'failed']);

export default class HeadsUpPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const scope = new Scope();
        const own = handle => {
            scope.add(handle);
            return handle;
        };
        const settings = keyValues(this.getSettings());
        const state = keyValues(this.getSettings(STATE_SCHEMA));
        const store = own(new SettingsStore({settings, state}));
        const gnomeKeys = makeGnomeKeys();

        Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(`${this.path}/icons`);
        window.set_default_size(640, 720);
        window.add(new FocusPage({editor: new FocusSettingsEditor(store), store, scope}).page);
        window.add(new GeneralPage({store, gnomeKeys, scope}).page);
        window.connect('close-request', () => {
            scope.dispose();
            return false;
        });
    }
}

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
class FocusPage {
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
        this.page = new Adw.PreferencesPage({title: Strings.Tabs.title('focus'), icon_name: 'timer-symbolic'});

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

/** Preferences → General: Wake Shortcut, Appearance, Close When You Click Elsewhere. */
class GeneralPage {
    #store;
    #gnomeKeys;
    #shortcutRow;
    #shortcutLabel;
    #warningIcon;
    #useButton;
    #giveBackButton;
    #closeRow;

    constructor({store, gnomeKeys, scope}) {
        this.#store = store;
        this.#gnomeKeys = gnomeKeys;
        this.page = new Adw.PreferencesPage({title: Strings.General.title, icon_name: 'preferences-symbolic'});
        this.page.banner = new Adw.Banner({title: Strings.Shortcut.offBanner, use_markup: false});

        const group = new Adw.PreferencesGroup();
        this.page.add(group);
        group.add(this.#wakeShortcutRow());
        group.add(this.#appearanceRow());
        this.#closeRow = new Adw.SwitchRow({title: Strings.General.closeOnClickOutside, use_markup: false});
        this.#closeRow.active = store.state['close-on-click-outside'];
        this.#closeRow.connect('notify::active', () => {
            if (this.#closeRow.active !== store.state['close-on-click-outside'])
                store.set('close-on-click-outside', this.#closeRow.active);
        });
        group.add(this.#closeRow);

        scope.add(store.on('changed', () => this.#sync()));
        this.#sync();
    }

    /** Wake Shortcut: the keys, the status note, and the consent buttons (UX §7). */
    #wakeShortcutRow() {
        this.#shortcutRow = new Adw.ActionRow({
            title: Strings.Shortcut.title,
            activatable: true,
            use_markup: false,
            subtitle_selectable: false,
        });
        this.#warningIcon = new Gtk.Image({icon_name: 'dialog-warning-symbolic', css_classes: ['warning']});
        this.#shortcutRow.add_prefix(this.#warningIcon);
        this.#shortcutLabel = new Gtk.ShortcutLabel({valign: Gtk.Align.CENTER});
        this.#useButton = new Gtk.Button({
            label: Strings.Shortcut.useButton,
            valign: Gtk.Align.CENTER,
        });
        this.#useButton.connect('clicked', () => this.#store.set('take-input-source-key', true));
        this.#giveBackButton = new Gtk.Button({
            label: Strings.Shortcut.giveBackButton,
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        this.#giveBackButton.connect('clicked', () => this.#store.set('take-input-source-key', false));
        this.#shortcutRow.add_suffix(this.#useButton);
        this.#shortcutRow.add_suffix(this.#giveBackButton);
        this.#shortcutRow.add_suffix(this.#shortcutLabel);
        this.#shortcutRow.connect('activated', () => this.#record());
        return this.#shortcutRow;
    }

    #appearanceRow() {
        const row = new Adw.ComboRow({
            title: Strings.General.appearance,
            subtitle: Strings.General.appearanceSubtitle,
            model: Gtk.StringList.new(APPEARANCES.map(value => Strings.General.appearanceOptions[value])),
            use_markup: false,
        });
        row.selected = Math.max(0, APPEARANCES.indexOf(this.#store.state['appearance']));
        row.connect('notify::selected', () => {
            const value = APPEARANCES[row.selected];
            if (value && value !== this.#store.state['appearance'])
                this.#store.set('appearance', value);
        });
        return row;
    }

    #sync() {
        const state = this.#store.state;
        const status = state['hud-shortcut-status'];
        const accel = state['hud-shortcut'][0] ?? '';
        const tookWithConsent = status === 'ok' && state['input-source-claim'] === 'taken' && state['take-input-source-key'];

        this.page.banner.revealed = status === 'off';
        this.#shortcutLabel.accelerator = accel;
        this.#shortcutRow.subtitle = this.#shortcutNote(status, tookWithConsent, Strings.accelLabel(accel));
        this.#warningIcon.visible = PROBLEM_STATUSES.has(status);
        this.#useButton.visible = status === 'layouts';
        this.#giveBackButton.visible = tookWithConsent;
        this.#closeRow.active = state['close-on-click-outside'];
        this.#closeRow.subtitle = Strings.General.closeOnClickOutsideSubtitle(
            status === 'ok' ? Strings.accelLabel(accel) : null);
    }

    /** The note under Wake Shortcut for each status (UX §7); `layouts` adds how layouts would switch. */
    #shortcutNote(status, tookWithConsent, shortcut) {
        if (tookWithConsent)
            return Strings.Shortcut.takenSubtitle;
        const note = Strings.Shortcut.note(status, this.#store.state['hud-shortcut-holder'], shortcut);
        if (status === 'layouts')
            return `${note}\n${Strings.Shortcut.layoutsDetail}`;
        return note ?? '';
    }

    /** The recorder dialog: Esc cancels, Backspace resets to Super+Space, a clash keeps Save off. */
    #record() {
        new RecorderDialog({
            current: this.#store.state['hud-shortcut'][0] ?? DEFAULT_SHORTCUT,
            bindings: () => this.#gnomeKeys.bindings(),
            save: accel => this.#store.set('hud-shortcut', [accel]),
        }).present(this.page);
    }
}

/** "Press the new shortcut", as Settings → Keyboard does (UX §7). */
class RecorderDialog {
    #dialog;
    #label;
    #problem;
    #save;
    #pending;
    #bindings;

    constructor({current, bindings, save}) {
        this.#pending = current;
        this.#bindings = bindings;

        this.#label = new Gtk.ShortcutLabel({accelerator: current, halign: Gtk.Align.CENTER});
        this.#problem = new Gtk.Label({wrap: true, justify: Gtk.Justification.CENTER, css_classes: ['error'], visible: false});
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });
        content.append(new Gtk.Label({label: Strings.Recorder.title, css_classes: ['title-4']}));
        content.append(this.#label);
        content.append(this.#problem);

        const cancel = new Gtk.Button({label: Strings.Recorder.cancel});
        this.#save = new Gtk.Button({label: Strings.Recorder.save, css_classes: ['suggested-action']});
        const header = new Adw.HeaderBar({show_start_title_buttons: false, show_end_title_buttons: false});
        header.pack_start(cancel);
        header.pack_end(this.#save);
        const view = new Adw.ToolbarView({content});
        view.add_top_bar(header);

        this.#dialog = new Adw.Dialog({child: view, content_width: 400});
        cancel.connect('clicked', () => this.#dialog.close());
        this.#save.connect('clicked', () => {
            save(this.#pending);
            this.#dialog.close();
        });

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval, keycode, mods) => this.#onKey(keyval, keycode, mods));
        this.#dialog.add_controller(keys);
        this.#check();
    }

    /**
     * Shows the dialog. While it is open, GNOME's own shortcuts (Super+Space among them) reach
     * the dialog instead of the shell, as in Settings → Keyboard; the shell may ask the user
     * once to allow it.
     */
    present(parent) {
        this.#dialog.present(parent);
        const toplevel = parent.get_root()?.get_surface();
        toplevel?.inhibit_system_shortcuts(null);
        this.#dialog.connect('closed', () => toplevel?.restore_system_shortcuts());
    }

    #onKey(keyval, keycode, mods) {
        const mask = mods & Gtk.accelerator_get_default_mod_mask();
        if (mask === 0 && keyval === Gdk.KEY_Escape) {
            this.#dialog.close();
            return true;
        }
        if (mask === 0 && keyval === Gdk.KEY_BackSpace) {
            this.#set(DEFAULT_SHORTCUT);
            return true;
        }
        // A modifier on its own: wait for the rest of the combination.
        if (isModifier(keyval))
            return true;
        this.#set(Gtk.accelerator_name_with_keycode(null, Gdk.keyval_to_lower(keyval), keycode, mask));
        return true;
    }

    #set(accel) {
        this.#pending = accel;
        this.#label.accelerator = accel;
        this.#check();
    }

    /** Save stays off while the keys can't be the shortcut. */
    #check() {
        const problem = recorderProblem(this.#pending, this.#bindings());
        this.#problem.visible = problem !== null;
        this.#problem.label = problem ? Strings.Recorder.problem(problem, Strings.accelLabel(this.#pending)) : '';
        this.#save.sensitive = problem === null;
    }
}

const MODIFIER_KEYS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Meta_L, Gdk.KEY_Meta_R, Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_ISO_Level3_Shift, Gdk.KEY_Caps_Lock,
]);

function isModifier(keyval) {
    return MODIFIER_KEYS.has(keyval);
}
