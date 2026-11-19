// HeadsUp for GNOME Shell (ADR-002 §5, §6.1). enable() builds everything under one root Scope;
// disable() disposes it, newest first, which does what the Mac's Quit did: the shortcut goes
// back to layout switching, its status becomes `off`, and nothing of HeadsUp stays on screen.

import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {clock as makeClock, Scheduler} from './lib/adapters/clock.js';
import {gnomeKeys, keyValues} from './lib/adapters/gsettings.js';
import {files} from './lib/adapters/files.js';
import {inhibitor} from './lib/adapters/inhibitor.js';
import {links} from './lib/adapters/links.js';
import {log} from './lib/adapters/log.js';
import {watchResume} from './lib/adapters/login1.js';
import {portProbe} from './lib/adapters/portProbe.js';
import {processes} from './lib/adapters/processes.js';
import {power} from './lib/adapters/upower.js';
import {createApp} from './lib/core/app.js';
import {Scope} from './lib/core/scope.js';
import {Hud} from './lib/shell/hud.js';
import {Idle} from './lib/shell/idle.js';
import {Indicator} from './lib/shell/indicator.js';
import {Notifier} from './lib/shell/notifier.js';
import * as W from './lib/shell/views/widgets.js';
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
        const notifier = own(new Notifier({session, icon: W.icon(this.path, 'timer')}));
        // While Orca runs, a start doesn't hide the HUD (the Mac's VoiceOver rule).
        const a11y = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.applications'});
        const screenReaderOn = () => a11y.get_boolean('screen-reader-enabled');
        const app = own(createApp({
            settings: keyValues(settings),
            state: keyValues(stateSettings),
            gnomeKeys: gnomeKeys(),
            hotkey: new Hotkey(stateSettings),
            session,
            hud,
            notifier,
            screenReaderOn,
            preferences: {open: () => this.openPreferences()},
            // Keep awake (ADR-002 §6.5): GNOME's session manager holds, UPower's power source.
            inhibitor: inhibitor(),
            power: own(power(log)),
            // Services (ADR-002 §6.4): each run in its own systemd scope; the last activity for
            // their keep-awake limit.
            processes: processes({log}),
            portProbe: portProbe(),
            files: files(),
            links: links(log),
            idle: own(new Idle()),
            log,
            clock,
            scheduler: own(new Scheduler(watchResume)),
        }));

        const indicator = new Indicator({stores: app, dir: this.path, scope: scope.child()});
        indicator.setVisible(!session.locked);
        own(session.watch(locked => indicator.setVisible(!locked)));
        // Last: an auto-open that createApp() asked for (the welcome) shows now.
        hud.attach(app, {dir: this.path});
    }

    disable() {
        for (const error of this.#scope.dispose())
            log('disable-failed', {error: error.name});
        this.#scope = null;
    }
}
