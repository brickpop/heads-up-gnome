// HeadsUp for GNOME Shell (ADR-002 §5, §6.1). enable() builds everything under one root Scope;
// disable() disposes it, newest first, which does what the Mac's Quit did: the shortcut goes
// back to layout switching, its status becomes `off`, and nothing of HeadsUp stays on screen.

import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {clock as makeClock, Scheduler} from './lib/adapters/clock.js';
import {gnomeKeys, keyValues} from './lib/adapters/gsettings.js';
import {log} from './lib/adapters/log.js';
import {watchResume} from './lib/adapters/login1.js';
import {createApp} from './lib/core/app.js';
import {Scope} from './lib/core/scope.js';
import {Hud} from './lib/shell/hud.js';
import {Indicator} from './lib/shell/indicator.js';
import {Hotkey} from './lib/shell/keybinding.js';
import {Session} from './lib/shell/session.js';

const STATE_SCHEMA = 'org.gnome.shell.extensions.headsup.state';

export default class HeadsUpExtension extends Extension {
    #scope = null;

    enable() {
        const scope = new Scope();
        this.#scope = scope;
        const own = handle => {
            scope.add(handle);
            return handle;
        };

        const settings = this.getSettings();
        const stateSettings = this.getSettings(STATE_SCHEMA);
        const clock = makeClock(new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}));
        const session = own(new Session());
        const hud = own(new Hud({session, clock}));
        const app = own(createApp({
            settings: keyValues(settings),
            state: keyValues(stateSettings),
            gnomeKeys: gnomeKeys(),
            hotkey: new Hotkey(stateSettings),
            session,
            hud,
            log,
            clock,
            scheduler: own(new Scheduler(watchResume)),
        }));

        const openPreferences = () => this.openPreferences();
        const indicator = new Indicator({stores: app, dir: this.path, openPreferences, scope: scope.child()});
        indicator.setVisible(!session.locked);
        own(session.watch(locked => indicator.setVisible(!locked)));
        // Last: an auto-open that createApp() asked for (the welcome) shows now.
        hud.attach(app, {dir: this.path, openPreferences});
    }

    disable() {
        for (const error of this.#scope.dispose())
            log('disable-failed', {error: error.name});
        this.#scope = null;
    }
}
