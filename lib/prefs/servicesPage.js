// Preferences → Services (UX §9; the Mac's services editor): the list of services, and the
// dialog that adds or edits one. The rules and the save are the core's (serviceDefinition.js,
// saveService); this file only draws the form and passes the draft.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {KEEP_AWAKE_CHOICES, draftChanged, draftOf, definitionOf, firstProblem, readDefinition, validEnvKey} from '../core/serviceDefinition.js';
import {showControls} from '../core/sanitize.js';
import {deleteService, saveService} from '../core/services.js';
import * as Strings from '../core/strings.js';

const F = () => Strings.ServiceForm;

/** The list: one row per service, opening its dialog; Add Service in the header. */
export class ServicesPage {
    #store;
    #files;
    #group;
    #rows = [];
    #shown = null;

    /**
     * @param {object} deps
     * @param {import('../core/settings.js').SettingsStore} deps.store
     * @param {{isFolder: (path: string) => Promise<boolean>}} deps.files
     * @param {import('../core/scope.js').Scope} deps.scope
     */
    constructor({store, files, scope}) {
        this.#store = store;
        this.#files = files;
        this.page = new Adw.PreferencesPage({
            name: 'services',
            title: Strings.Tabs.title('services'),
            icon_name: 'services-symbolic',
            description: F().pageDescription,
        });
        // No title: the page names it; the intro says what services are.
        this.#group = new Adw.PreferencesGroup({description: F().intro});
        const add = new Gtk.Button({label: F().add, valign: Gtk.Align.CENTER, css_classes: ['flat']});
        add.connect('clicked', () => this.#open(null));
        this.#group.header_suffix = add;
        this.page.add(this.#group);
        scope.add(store.on('changed', key => (key === 'services' || key === 'running-services') && this.#sync()));
        this.#sync();
    }

    #definitions() {
        return (this.#store.state.services ?? []).map(readDefinition);
    }

    #sync() {
        const definitions = this.#definitions();
        const shown = JSON.stringify(definitions);
        if (shown === this.#shown)
            return;
        this.#shown = shown;
        for (const row of this.#rows)
            this.#group.remove(row);
        this.#rows = definitions.length ? definitions.map(d => this.#row(d)) : [this.#emptyRow()];
        for (const row of this.#rows)
            this.#group.add(row);
    }

    /** A service: its name, and its command line; "Can't start · <reason>" when it breaks a rule. */
    #row(d) {
        const problem = firstProblem(d);
        const row = new Adw.ActionRow({
            title: d.name,
            // Hidden characters shown as ⟨ESC⟩, as in the HUD's row (Scan).
            subtitle: problem ? Strings.Services.cantStart(problem) : Strings.Services.actionSubtitle(showControls(d.command), showControls(d.cwd)),
            use_markup: false,
            activatable: true,
            subtitle_lines: 1,
        });
        if (problem)
            row.add_css_class('error');
        row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
        row.connect('activated', () => this.#open(d));
        return row;
    }

    /** "No services yet", and Add Service. */
    #emptyRow() {
        const row = new Adw.ActionRow({title: F().empty, use_markup: false});
        const add = new Gtk.Button({label: F().add, valign: Gtk.Align.CENTER});
        add.connect('clicked', () => this.#open(null));
        row.add_suffix(add);
        return row;
    }

    #open(definition) {
        const running = definition !== null && (this.#store.state['running-services'] ?? []).includes(definition.id);
        new ServiceDialog({store: this.#store, files: this.#files, definition, running}).present(this.page);
    }
}

/**
 * Adds or edits one service. Cancel and Save in the header; Esc or Cancel with changes asks
 * "Discard Changes?" first. Remove at the bottom asks only while the service runs.
 */
class ServiceDialog {
    #store;
    #files;
    #definition;
    #id;
    #dialog;
    #save;
    #fields = {};
    #env;
    #envRows = [];
    /** The Add Variable row, kept last in the Environment group. */
    #addVariable = null;
    #folder;
    #closing = false;

    constructor({store, files, definition, running}) {
        this.#store = store;
        this.#files = files;
        this.#definition = definition;
        this.#id = definition?.id ?? GLib.uuid_string_random();
        const draft = draftOf(definition);

        const page = new Adw.PreferencesPage();
        if (running) {
            // The changes reach the process only at its next start.
            page.banner = new Adw.Banner({title: F().runningNote, revealed: true, use_markup: false});
        }

        const main = new Adw.PreferencesGroup({description: F().commandHelp});
        this.#fields.name = this.#entry(main, Strings.ListForm.name, draft.name);
        this.#fields.command = this.#entry(main, Strings.ListForm.command, draft.command);
        this.#fields.command.add_css_class('monospace');
        this.#folder = draft.cwd;
        this.#fields.cwd = new Adw.ActionRow({title: Strings.ListForm.folder, subtitle: draft.cwd, use_markup: false});
        const choose = new Gtk.Button({label: Strings.ListForm.choose, valign: Gtk.Align.CENTER});
        choose.connect('clicked', () => this.#chooseFolder());
        this.#fields.cwd.add_suffix(choose);
        main.add(this.#fields.cwd);
        page.add(main);

        // Environment: one KEY=value row each, then Add Variable.
        this.#env = new Adw.PreferencesGroup({
            title: F().environment,
            description: `${F().environmentWarning}\n${F().environmentHint}`,
        });
        for (const v of draft.env)
            this.#addEnvRow(`${v.key}=${v.value}`);
        const addVariable = new Adw.ButtonRow({title: F().addVariable, start_icon_name: 'list-add-symbolic'});
        addVariable.connect('activated', () => this.#addEnvRow('', true));
        this.#env.add(addVariable);
        this.#addVariable = addVariable;
        page.add(this.#env);

        const options = new Adw.PreferencesGroup();
        this.#fields.port = this.#entry(options, F().port, draft.port);
        this.#fields.port.input_purpose = Gtk.InputPurpose.DIGITS;
        options.description = F().portHelp;
        this.#fields.autostart = new Adw.SwitchRow({title: F().autostart, subtitle: F().autostartHelp, active: draft.autostart, use_markup: false});
        options.add(this.#fields.autostart);
        this.#fields.keepAwake = new Adw.ComboRow({
            title: F().keepAwake,
            subtitle: F().keepAwakeHelp,
            use_markup: false,
            model: Gtk.StringList.new(KEEP_AWAKE_CHOICES.map(F().keepAwakeChoice)),
            selected: Math.max(0, KEEP_AWAKE_CHOICES.indexOf(draft.keepAwake)),
        });
        options.add(this.#fields.keepAwake);
        this.#fields.restartOnExit = new Adw.SwitchRow({title: F().restartOnExit, subtitle: F().restartOnExitHelp, active: draft.restartOnExit, use_markup: false});
        options.add(this.#fields.restartOnExit);
        page.add(options);

        if (definition) {
            const remove = new Adw.PreferencesGroup();
            const row = new Adw.ButtonRow({title: Strings.ListForm.remove, css_classes: ['destructive-action']});
            row.connect('activated', () => this.#remove(running));
            remove.add(row);
            page.add(remove);
        }

        const cancel = new Gtk.Button({label: F().cancel});
        this.#save = new Gtk.Button({label: Strings.ListForm.save, css_classes: ['suggested-action']});
        const header = new Adw.HeaderBar({show_start_title_buttons: false, show_end_title_buttons: false});
        header.pack_start(cancel);
        header.pack_end(this.#save);
        const view = new Adw.ToolbarView({content: page});
        view.add_top_bar(header);
        this.#dialog = new Adw.Dialog({
            child: view,
            title: definition ? F().editTitle(definition.name) : F().newTitle,
            content_width: 560,
            content_height: 680,
            can_close: false,
        });
        cancel.connect('clicked', () => this.#dialog.close());
        this.#save.connect('clicked', () => this.#trySave());
        // Esc and Cancel come here: with changes, ask first.
        this.#dialog.connect('close-attempt', () => this.#askDiscard());
        this.#checkEnv();
    }

    present(parent) {
        this.#dialog.present(parent);
    }

    #entry(group, title, text) {
        const row = new Adw.EntryRow({title, text, use_markup: false});
        group.add(row);
        return row;
    }

    /** A KEY=value row, with its remove button; it turns red while its key breaks the rule. */
    #addEnvRow(text, focus = false) {
        const row = new Adw.EntryRow({title: F().envRowTitle, text, use_markup: false});
        row.add_css_class('monospace');
        const remove = new Gtk.Button({icon_name: 'close-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'], tooltip_text: F().removeVariable});
        remove.connect('clicked', () => {
            this.#env.remove(row);
            this.#envRows = this.#envRows.filter(r => r !== row);
            this.#checkEnv();
        });
        row.add_suffix(remove);
        row.connect('changed', () => this.#checkEnv());
        // Before Add Variable, which stays last.
        if (this.#addVariable) {
            this.#env.remove(this.#addVariable);
            this.#env.add(row);
            this.#env.add(this.#addVariable);
        } else {
            this.#env.add(row);
        }
        this.#envRows.push(row);
        if (focus)
            row.grab_focus();
    }

    /** Save stays off while a variable's key breaks the rule; the row says why. */
    #checkEnv() {
        let valid = true;
        for (const row of this.#envRows) {
            const ok = !row.text || validEnvKey(row.text.split('=')[0]);
            row.tooltip_text = ok ? null : Strings.Services.envKeyProblem;
            if (ok)
                row.remove_css_class('error');
            else
                row.add_css_class('error');
            valid &&= ok;
        }
        this.#save.sensitive = valid;
    }

    /** The form as a draft, in the core's shape. */
    #draft() {
        return {
            name: this.#fields.name.text,
            command: this.#fields.command.text,
            cwd: this.#folder,
            env: this.#envRows.filter(row => row.text).map(row => {
                const at = row.text.indexOf('=');
                return at < 0 ? {key: row.text, value: ''} : {key: row.text.slice(0, at), value: row.text.slice(at + 1)};
            }),
            port: this.#fields.port.text,
            autostart: this.#fields.autostart.active,
            keepAwake: KEEP_AWAKE_CHOICES[this.#fields.keepAwake.selected] ?? 'off',
            restartOnExit: this.#fields.restartOnExit.active,
        };
    }

    #chooseFolder() {
        const dialog = new Gtk.FileDialog({modal: true});
        const window = this.#dialog.get_root();
        dialog.select_folder(window instanceof Gtk.Window ? window : null, null, (_d, result) => {
            try {
                const folder = dialog.select_folder_finish(result);
                if (!folder?.get_path())
                    return;
                this.#folder = folder.get_path();
                this.#fields.cwd.subtitle = this.#folder;
            } catch {
                // Cancelled: the folder stays.
            }
        });
    }

    /** Save: the core checks every rule; a problem shows on its row, else the dialog closes. */
    async #trySave() {
        this.#save.sensitive = false;
        const result = definitionOf(this.#draft(), this.#id);
        const found = result.portProblem
            ? {port: Strings.Services.portProblem}
            : await saveService(this.#store, this.#files, result.definition);
        this.#save.sensitive = true;
        for (const [field, row] of Object.entries(this.#fields)) {
            const problem = found[field];
            if (!(row instanceof Adw.EntryRow || row instanceof Adw.ActionRow))
                continue;
            row.tooltip_text = problem ?? null;
            if (problem)
                row.add_css_class('error');
            else
                row.remove_css_class('error');
        }
        if (found.env) {
            for (const row of this.#envRows)
                row.add_css_class('error');
        }
        if (!Object.keys(found).length)
            this.#forceClose();
        else
            this.#checkEnv();
    }

    /** Remove: at once, or after the question while it runs (stopping it). */
    #remove(running) {
        if (!running) {
            deleteService(this.#store, this.#id);
            this.#forceClose();
            return;
        }
        const alert = new Adw.AlertDialog({heading: F().removeHeading(this.#definition.name), body: F().removeRunningBody});
        alert.add_response('cancel', F().cancel);
        alert.add_response('remove', F().remove);
        alert.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
        alert.default_response = 'cancel';
        alert.close_response = 'cancel';
        alert.connect('response', (_a, response) => {
            if (response === 'remove') {
                deleteService(this.#store, this.#id);
                this.#forceClose();
            }
        });
        alert.present(this.#dialog);
    }

    /** Esc or Cancel: closes at once without changes; with changes, "Discard Changes?" first. */
    #askDiscard() {
        if (this.#closing)
            return;
        if (!draftChanged(this.#draft(), this.#definition)) {
            this.#forceClose();
            return;
        }
        const alert = new Adw.AlertDialog({
            heading: F().discardHeading,
            body: this.#definition ? F().discardBody(this.#definition.name) : F().discardBodyNew,
        });
        alert.add_response('keep', F().keepEditing);
        alert.add_response('discard', F().discard);
        alert.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
        alert.default_response = 'keep';
        alert.close_response = 'keep';
        alert.connect('response', (_a, response) => response === 'discard' && this.#forceClose());
        alert.present(this.#dialog);
    }

    #forceClose() {
        this.#closing = true;
        this.#dialog.force_close();
    }
}
