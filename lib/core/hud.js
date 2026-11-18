// HudStore: when the HUD opens and closes, its tab, and the welcome (ADR-002 §4, §6.1).
//
// It is the core half of the lock gate (G2): while the screen is locked nothing opens and
// nothing changes; one auto-open (a focus or break end, the welcome) waits and plays once
// after unlock, unless the user hides the HUD first. The shell's Hud adapter also refuses
// on its own: two gates on purpose.

import {Emitter} from './emitter.js';
import {Scope} from './scope.js';

export const TABS = Object.freeze(['chat', 'focus', 'caffeine', 'services', 'commands']);

export class HudStore extends Emitter {
    #hud;
    #session;
    #store;
    #scope = new Scope();

    /**
     * `visible`, and `focused` (shown with the grab); `showsWelcome`: the Chat tab shows the
     * welcome; `autoOpenWaiting`: an auto-open waits for the unlock.
     */
    state = Object.freeze({
        tab: 'chat', visible: false, focused: false,
        showsWelcome: false, autoOpenWaiting: false,
    });

    /**
     * @param {object} ports
     * @param {import('./ports.js').Hud} ports.hud
     * @param {import('./ports.js').Session} ports.session
     * @param {import('./settings.js').SettingsStore} ports.store
     */
    constructor({hud, session, store}) {
        super();
        this.#hud = hud;
        this.#session = session;
        this.#store = store;
        this.#update({showsWelcome: this.#welcomeDue('chat')});
        this.#scope.add(session.watch(locked => (locked ? this.#locked() : this.#unlocked())));
        this.#scope.add(store.on('changed', key => {
            if (key === 'welcome-done')
                this.#update({showsWelcome: this.#welcomeDue(this.state.tab)});
        }));
    }

    /** Shown without the grab, or the grab dropped while it stays shown. */
    show() {
        if (this.#session.locked)
            return;
        this.#hud.show();
        this.#update({visible: true, focused: false});
    }

    /** Shown with the grab: a click on the HUD or the indicator. */
    focus() {
        if (this.#session.locked)
            return;
        // The shell may refuse the grab (another modal holds it): then it is shown, not focused.
        const focused = this.#hud.focus();
        this.#update({visible: true, focused});
    }

    /** Closes the HUD. It ends the welcome; while locked, it drops a waiting auto-open. */
    hide() {
        if (this.state.visible)
            this.#endWelcome();
        this.#hud.hide();
        this.#update({visible: false, focused: false, autoOpenWaiting: false});
    }

    /** A click on the indicator: closes a focused HUD, else focuses it. */
    toggle() {
        if (this.state.focused)
            this.hide();
        else
            this.focus();
    }

    /** The wake shortcut: focuses the HUD unless it has the focus already, then closes it. */
    hotkeyPressed() {
        if (this.#session.locked)
            return;
        if (this.state.visible)
            this.#endWelcome();
        if (!this.state.focused)
            this.focus();
        else
            this.hide();
    }

    /** The grab was lost: a click outside, another modal, the overview. */
    didResignKey() {
        if (this.#session.locked || !this.state.visible)
            return;
        if (this.#store.state['close-on-click-outside'])
            this.hide();
        else
            this.show();
    }

    /** Opens without the grab (a timer ended, the welcome); while locked, waits for the unlock. */
    autoOpen() {
        if (this.#session.locked) {
            this.#update({autoOpenWaiting: true});
            return;
        }
        if (this.state.visible)
            return;
        this.show();
    }

    selectTab(tab) {
        if (this.#session.locked || !TABS.includes(tab) || tab === this.state.tab)
            return;
        this.#endWelcome();
        this.#update({tab, showsWelcome: this.#welcomeDue(tab)});
    }

    nextTab() {
        this.selectTab(TABS[(TABS.indexOf(this.state.tab) + 1) % TABS.length]);
    }

    previousTab() {
        this.selectTab(TABS[(TABS.indexOf(this.state.tab) + TABS.length - 1) % TABS.length]);
    }

    /** "Set up a model" on the welcome. */
    endWelcome() {
        if (!this.#session.locked)
            this.#endWelcome();
    }

    /** The × on the one-time layout notice. */
    dismissLayoutNotice() {
        if (!this.#session.locked && this.#store.state['layout-notice'])
            this.#store.set('layout-notice', false);
    }

    dispose() {
        this.#scope.dispose();
    }

    #welcomeDue(tab) {
        return tab === 'chat' && !this.#store.state['welcome-done'];
    }

    #endWelcome() {
        if (this.state.showsWelcome)
            this.#store.set('welcome-done', true);
    }

    #locked() {
        this.#hud.hide();
        this.#update({visible: false, focused: false});
    }

    #unlocked() {
        if (!this.state.autoOpenWaiting)
            return;
        this.#update({autoOpenWaiting: false});
        this.autoOpen();
    }

    #update(changes) {
        const next = {...this.state, ...changes};
        if (Object.keys(next).every(key => next[key] === this.state[key]))
            return;
        this.state = Object.freeze(next);
        this.emit('changed');
    }
}
