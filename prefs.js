// HeadsUp's preferences window (UX §7, §9): it builds the pages that have something to set so
// far (no empty pages), each in lib/prefs/. Every write goes through SettingsStore (ADR-002 §4);
// the shell does the rest when it sees the change. Prefs never touch lib/shell.

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {FocusSettingsEditor} from './lib/core/focusSettings.js';
import {Scope} from './lib/core/scope.js';
import {SettingsStore} from './lib/core/settings.js';
import {files} from './lib/adapters/files.js';
import {gnomeKeys as makeGnomeKeys, keyValues} from './lib/adapters/gsettings.js';
import {FocusPage} from './lib/prefs/focusPage.js';
import {GeneralPage} from './lib/prefs/generalPage.js';
import {ServicesPage} from './lib/prefs/servicesPage.js';

const STATE_SCHEMA = 'org.gnome.shell.extensions.headsup.state';

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
        const pages = [
            new FocusPage({editor: new FocusSettingsEditor(store), store, scope}).page,
            new ServicesPage({store, files: files(), scope}).page,
            new GeneralPage({store, gnomeKeys, scope}).page,
        ];
        for (const page of pages)
            window.add(page);
        showAskedPage(window, store, pages);
        scope.add(store.on('changed', key => key === 'prefs-page' && showAskedPage(window, store, pages)));
        window.connect('close-request', () => {
            scope.dispose();
            return false;
        });
    }
}

/**
 * The page the HUD asked for (`prefs-page`, ADR-002 §4): at open, and while the window is open,
 * since opening Preferences again only brings it forward. It is shown, then the key is cleared;
 * an unknown name shows the first page. Empty: the window keeps its page.
 */
function showAskedPage(window, store, pages) {
    const asked = store.state['prefs-page'];
    if (!asked)
        return;
    window.visible_page_name = pages.some(page => page.name === asked) ? asked : pages[0].name;
    store.set('prefs-page', '');
}
