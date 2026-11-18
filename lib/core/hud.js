// HudStore: when the HUD opens and closes, its tab, and the welcome (ADR-002 §4, §6.1).
//
// It is the core half of the lock gate (G2): while the screen is locked nothing opens and
// nothing changes; one auto-open (a focus or break end, the welcome) waits and plays once
// after unlock, unless the user hides the HUD first. The shell's Hud adapter also refuses
// on its own: two gates on purpose.

import {Emitter} from './emitter.js';
import {Scope} from './scope.js';

export const TABS = Object.freeze(['chat', 'focus', 'caffeine', 'services', 'commands']);

/** How long a toast replaces the footer hints, in ms (the Mac's). */
export const TOAST_MS = 2600;

export class HudStore extends Emitter {
    #hud;
    #session;
    #store;
    #clock;
    #scheduler;
    #actions;
    #scope = new Scope();
    #waitingTab = null;
    #toastTimer = null;
    #toastSeq = 0;

    /**
     * `visible`, and `focused` (shown with the grab); `showsWelcome`: the Chat tab shows the
     * welcome; `autoOpenWaiting`: an auto-open waits for the unlock; `toast`: `{text, seq}`
     * in place of the footer hints, or null (`seq` goes up with each toast, so the same text
     * twice is announced twice); `input`: the prompt's text; `suggestions`: its rows (see
     * matcher.js); `selected`: the selected row's index, or null.
     */
    state = Object.freeze({
        tab: 'chat', visible: false, focused: false,
        showsWelcome: false, autoOpenWaiting: false, toast: null,
        input: '', suggestions: Object.freeze([]), selected: null,
    });

    /**
     * @param {object} ports
     * @param {import('./ports.js').Hud} ports.hud
     * @param {import('./ports.js').Session} ports.session
     * @param {import('./settings.js').SettingsStore} ports.store
     * @param {import('./ports.js').Clock} ports.clock
     * @param {import('./ports.js').Scheduler} ports.scheduler
     * @param {import('./actions.js').ActionRegistry} ports.actions  what the prompt matches
     */
    constructor({hud, session, store, clock, scheduler, actions}) {
        super();
        this.#hud = hud;
        this.#session = session;
        this.#store = store;
        this.#clock = clock;
        this.#scheduler = scheduler;
        this.#actions = actions;
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

    /** Shown with the grab: a click on the HUD, the indicator, a notification (on `tab`). */
    focus(tab = null) {
        if (this.#session.locked)
            return;
        if (tab)
            this.selectTab(tab);
        // The shell may refuse the grab (another modal holds it): then it is shown, not focused.
        const focused = this.#hud.focus();
        this.#update({visible: true, focused});
    }

    /**
     * Closes the HUD. It ends the welcome and empties the prompt, so the HUD reopens on the
     * tab's view, not old rows; while locked, it drops a waiting auto-open.
     */
    hide() {
        if (this.state.visible)
            this.#endWelcome();
        this.#hud.hide();
        this.#waitingTab = null;
        this.#update({visible: false, focused: false, autoOpenWaiting: false, input: '', suggestions: Object.freeze([]), selected: null});
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

    /**
     * Something ended and wants to show, without disturbing what the user does (the Mac's
     * autoOpen): a closed HUD opens on `tab` without the grab; an open one in use stays as
     * it is and toasts `announcement`; an open one not in use switches to `tab`. While locked,
     * it waits, with its tab, and plays once after unlock.
     */
    autoOpen(tab = null, announcement = null) {
        if (this.#session.locked) {
            this.#waitingTab = tab ?? this.#waitingTab;
            this.#update({autoOpenWaiting: true});
            return;
        }
        if (!this.state.visible) {
            if (tab)
                this.selectTab(tab);
            this.show();
        } else if (!tab || tab === this.state.tab) {
            // Already on its tab: the prompt shows in place.
        } else if (this.state.focused) {
            if (announcement)
                this.toast(announcement);
        } else {
            this.selectTab(tab);
        }
    }

    /**
     * The prompt's text changed: the suggestions follow, the first row selected when it can
     * be (after "No matching actions", ↓ reaches the next row). No Ask row until the chat
     * comes (slice 5).
     */
    setInput(text) {
        if (this.#session.locked || typeof text !== 'string')
            return;
        const suggestions = Object.freeze(this.#actions.match(text, {ask: undefined, inConversation: false}));
        this.#update({input: text, suggestions, selected: suggestions[0] && suggestions[0].kind !== 'noMatch' ? 0 : null});
    }

    /** ↑ (-1) or ↓ (+1): the previous or next selectable row, stopping at the ends. */
    moveSelection(delta) {
        const rows = this.state.suggestions;
        const selectable = rows.map((row, i) => (row.kind === 'noMatch' ? -1 : i)).filter(i => i >= 0);
        if (!selectable.length)
            return;
        const at = selectable.indexOf(this.state.selected);
        const next = at < 0 ? selectable[0] : selectable[Math.min(Math.max(at + delta, 0), selectable.length - 1)];
        this.#update({selected: next});
    }

    /** The pointer moved onto a row: it is selected, unless it can't be. */
    selectRow(index) {
        if (this.state.suggestions[index] && this.state.suggestions[index].kind !== 'noMatch')
            this.#update({selected: index});
    }

    /** Enter: runs the selected row (see runRow). */
    runSelected() {
        this.runRow(this.state.selected);
    }

    /**
     * Runs the action at `index` (a click, or Enter on the selected row), after clearing the
     * prompt (so its own hide after a start isn't cancelled by the change). The Ask row does
     * nothing until the chat (slice 5).
     */
    runRow(index) {
        const row = this.state.suggestions[index];
        if (this.#session.locked || row?.kind !== 'action')
            return;
        this.setInput('');
        row.action.run();
    }

    /** Shows `text` in place of the footer hints for TOAST_MS; a new toast replaces it. */
    toast(text) {
        this.#toastTimer?.dispose();
        this.#toastSeq++;
        this.#update({toast: Object.freeze({text, seq: this.#toastSeq})});
        const timer = this.#scope.add(this.#scheduler.at(new Date(this.#clock.now().getTime() + TOAST_MS), () => {
            timer.dispose();
            this.#toastTimer = null;
            this.#update({toast: null});
        }));
        this.#toastTimer = timer;
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
        const tab = this.#waitingTab;
        this.#waitingTab = null;
        this.#update({autoOpenWaiting: false});
        this.autoOpen(tab);
    }

    #update(changes) {
        const next = {...this.state, ...changes};
        if (Object.keys(next).every(key => next[key] === this.state[key]))
            return;
        this.state = Object.freeze(next);
        this.emit('changed');
    }
}

/**
 * The dots on the inactive tabs (the Mac's tabActivity): Focus while a focus, a break or a
 * prompt is under way; Caffeine while on or while services keep the computer awake.
 * Services join with their slice.
 */
export function tabActivity({focus, caffeine}) {
    const activity = {};
    if (focus.phase.kind !== 'idle')
        activity.focus = 'active';
    const c = caffeine.snapshot;
    if (c.on || c.serviceHolds.some(h => h.awake !== 'refused'))
        activity.caffeine = 'active';
    return activity;
}
