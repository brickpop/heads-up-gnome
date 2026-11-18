// What the top bar indicator shows (the Mac's StatusItemModel; UX §2). A pure function of the
// Focus snapshot and the time, so the indicator redraws only at `nextChange`, not every
// second: nothing fires while idle. Caffeine's cup joins in slice 2.

import {Emitter} from './emitter.js';
import * as format from './format.js';
import {Scope} from './scope.js';
import {Indicator, MenuBar} from './strings.js';

/** How long after a rounding boundary the redraw happens, so it lands on the new value (ms). */
const TICK_MS = 1;

/** The focus text: minutes rounded up ("18m"), or m:ss with seconds on. */
const focusText = (left, showSeconds) => (showSeconds ? format.clock(left) : format.minutes(left, 'up'));

/** The next moment (ms) the focus text differs, or null when time is up (the store moves on). */
function nextFocusChange(endsAt, now, showSeconds) {
    const left = (endsAt - now) / 1000;
    if (left <= 0)
        return null;
    if (showSeconds)
        return endsAt - (Math.ceil(left) - 1) * 1000;
    return endsAt - (format.wholeMinutes(left, 'up') - 1) * 60_000;
}

/**
 * @param {object} focus  FocusStore.snapshot
 * @param {number} now  ms
 * @param {boolean} showSeconds  the menu-seconds setting
 * @returns {{parts: {kind: 'timer', text: string, warning: boolean}[], accessibleName: string, nextChange: number | null}}
 *   `warning` draws the text in the warn colour: the round waits on the user (a prompt,
 *   waiting or snoozed, or a paused timer).
 */
export function indicatorModel(focus, now, showSeconds) {
    let part;
    let spoken;
    let nextChange = null;
    if (focus.kind === 'idle') {
        part = {kind: 'timer', text: Indicator.idle, warning: false};
        spoken = Indicator.idle.toLowerCase();
    } else if (focus.kind === 'running') {
        const left = (focus.endsAt - now) / 1000;
        part = {kind: 'timer', text: focusText(left, showSeconds), warning: false};
        spoken = `${MenuBar.kindName(focus.run)}, ${format.spokenMinutes(left, 'up')} left`;
        nextChange = nextFocusChange(focus.endsAt, now, showSeconds);
    } else if (focus.kind === 'paused') {
        part = {kind: 'timer', text: focusText(focus.left, showSeconds), warning: true};
        spoken = `${MenuBar.kindName(focus.run)} paused, ${format.spokenMinutes(focus.left, 'up')} left`;
    } else {
        // A snoozed prompt still waits on the user: it reads as the prompt does.
        const words = focus.prompt === 'breakDue' ? MenuBar.breakDue : MenuBar.noFocus;
        part = {kind: 'timer', text: words, warning: true};
        spoken = words.toLowerCase();
    }
    return {parts: [part], accessibleName: Indicator.accessibleName([spoken]), nextChange};
}

/**
 * The indicator's state, kept current: it redraws at each `nextChange` and whenever Focus or
 * the menu-seconds setting changes. `click()` is the left click.
 */
export class IndicatorModel extends Emitter {
    #focus;
    #hud;
    #store;
    #clock;
    #scheduler;
    #scope = new Scope();
    #redraw = null;
    state;

    /**
     * @param {object} ports
     * @param {import('./focus.js').FocusStore} ports.focus
     * @param {import('./hud.js').HudStore} ports.hudStore
     * @param {import('./settings.js').SettingsStore} ports.store
     * @param {import('./ports.js').Clock} ports.clock
     * @param {import('./ports.js').Scheduler} ports.scheduler
     */
    constructor({focus, hudStore, store, clock, scheduler}) {
        super();
        this.#focus = focus;
        this.#hud = hudStore;
        this.#store = store;
        this.#clock = clock;
        this.#scheduler = scheduler;
        this.#scope.add(focus.on('changed', () => this.#update()));
        this.#scope.add(store.on('changed', key => key === 'menu-seconds' && this.#update()));
        this.#update();
    }

    /**
     * The left click: toggles the HUD. While the round waits on the user (amber), it leads to
     * Focus: a HUD that is focused on Focus closes; any other (closed, on another tab, or
     * shown on Focus without the keyboard) is focused on Focus.
     */
    click() {
        const amber = this.state.parts.some(p => p.warning);
        const hud = this.#hud.state;
        if (!amber)
            this.#hud.toggle();
        else if (hud.visible && hud.focused && hud.tab === 'focus')
            this.#hud.hide();
        else
            this.#hud.focus('focus');
    }

    dispose() {
        this.#scope.dispose();
    }

    #update() {
        this.#redraw?.dispose();
        this.#redraw = null;
        const model = indicatorModel(this.#focus.snapshot, this.#clock.now().getTime(), this.#store.state['menu-seconds']);
        const {nextChange, ...state} = model;
        if (JSON.stringify(state) !== JSON.stringify(this.state)) {
            this.state = Object.freeze(state);
            this.emit('changed');
        }
        if (nextChange !== null)
            this.#redraw = this.#scope.add(this.#scheduler.at(new Date(nextChange + TICK_MS), () => this.#update()));
    }
}
