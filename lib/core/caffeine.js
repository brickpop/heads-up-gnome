// CaffeineStore: keeps the computer awake for a while (the Mac's CaffeineStore; Caffeine spec;
// ADR-002 §6.5), through KeepAwake, only while on and not while paused on battery.
//
// The countdown runs on the wall clock, on battery too; one wake-up is armed at the end date,
// and the end turns Caffeine off. Turning HeadsUp off ends Caffeine, as Quit did on the Mac.

import {Emitter} from './emitter.js';
import * as format from './format.js';
import {Scope} from './scope.js';
import {Caffeine} from './strings.js';

export const DURATIONS = Object.freeze(['15m', '1h', '2h', 'until-off']);
const MINUTES = {'15m': 15, '1h': 60, '2h': 120, 'until-off': null};
/** The extend choices, in minutes: the HUD's buttons and the actions. */
export const EXTEND_MINUTES = Object.freeze([10, 60]);
const HOLDER = 'caffeine';
const SETTINGS_KEYS = new Set(['keep-display-on', 'prevent-system-sleep', 'only-on-ac', 'caffeine-duration']);

/**
 * The Caffeine options from the settings, by the rule: keeping the display on and preventing
 * system sleep can't both be off (both off read as both on).
 */
export function readCaffeineSettings(state) {
    let keepDisplayOn = state['keep-display-on'] !== false;
    let preventSystemSleep = state['prevent-system-sleep'] !== false;
    if (!keepDisplayOn && !preventSystemSleep)
        keepDisplayOn = preventSystemSleep = true;
    return Object.freeze({
        keepDisplayOn, preventSystemSleep,
        onlyOnAC: state['only-on-ac'] === true,
        lastDuration: DURATIONS.includes(state['caffeine-duration']) ? state['caffeine-duration'] : '1h',
    });
}

const kindsOf = options => [...options.keepDisplayOn ? ['display'] : [], ...options.preventSystemSleep ? ['system'] : []];

export class CaffeineStore extends Emitter {
    #clock;
    #scheduler;
    #store;
    #keepAwake;
    #hud;
    #serviceHolds;
    #scope = new Scope();
    #expiry = null;
    #isOn = false;
    /** When it turns off by itself (ms); null for Until off, or while off. */
    #endsAt = null;
    /** What GNOME refused at the last start or change: 'refused', 'displayRefused', 'systemRefused', or null. */
    #problem = null;
    #cardMoves = 0;
    /** The toast of the last start: shown once GNOME holds something, dropped if it refuses all. */
    #pendingToast = null;
    #wasPaused = false;
    state;

    /**
     * @param {object} ports
     * @param {import('./ports.js').Clock} ports.clock
     * @param {import('./ports.js').Scheduler} ports.scheduler
     * @param {import('./settings.js').SettingsStore} ports.store
     * @param {import('./keepAwake.js').KeepAwake} ports.keepAwake
     * @param {import('./hud.js').HudStore} ports.hudStore  for the toasts
     * @param {() => {name: string, awake: 'holding'|'pausedOnBattery'|'refused'}[]} [ports.serviceHolds]
     *   the services whose hold applies, in list order (slice 3)
     */
    constructor({clock, scheduler, store, keepAwake, hudStore, serviceHolds = () => []}) {
        super();
        this.#clock = clock;
        this.#scheduler = scheduler;
        this.#store = store;
        this.#keepAwake = keepAwake;
        this.#hud = hudStore;
        this.#serviceHolds = serviceHolds;
        this.#wasPaused = keepAwake.pausedOnBattery;
        this.#scope.add(keepAwake.on('changed', () => this.#holdsChanged()));
        this.#scope.add(store.on('changed', key => {
            if (!SETTINGS_KEYS.has(key))
                return;
            // Options changed elsewhere (prefs, dconf) apply at once while on.
            if (this.#isOn && key !== 'caffeine-duration')
                this.#applyHolds();
            this.#emit();
        }));
        this.#refresh();
    }

    // State.

    get options() {
        return readCaffeineSettings(this.#store.state);
    }

    /** The last duration used: the switch, the menu and the actions turn on with it. */
    get lastDuration() {
        return this.options.lastDuration;
    }

    get isOn() {
        return this.#isOn;
    }

    get endsAt() {
        return this.#endsAt;
    }

    /** On, with "Only on power adapter", on battery: the countdown runs, nothing is held. */
    get pausedOnBattery() {
        return this.#isOn && this.#keepAwake.pausedOnBattery;
    }

    /**
     * What the indicator, the menu and the tab dot need: {on, endsAt, pausedOnBattery,
     * serviceHolds}.
     */
    get snapshot() {
        return {on: this.#isOn, endsAt: this.#endsAt, pausedOnBattery: this.pausedOnBattery, serviceHolds: this.#serviceHolds()};
    }

    /** The footer pill at `now` (ms): "Awake 58m", "Awake", "Paused 45m", "Paused"; null while off. */
    pill(now) {
        if (!this.#isOn)
            return null;
        const left = this.#endsAt === null ? null : format.minutes((this.#endsAt - now) / 1000, 'nearest');
        return this.pausedOnBattery ? Caffeine.pillPaused(left) : Caffeine.pillAwake(left);
    }

    // Turning on and off.

    /** The switch, in the tab and in the menu: on with the last-used duration, or off. */
    toggle() {
        if (this.#isOn) {
            this.turnOff();
            return;
        }
        this.#start(this.lastDuration, paused => (paused ? Caffeine.onPausedBySwitch : Caffeine.onBySwitch));
    }

    /** A duration card: while off it turns on with it and toasts; while on it restarts the timer. */
    selectDuration(duration) {
        if (!DURATIONS.includes(duration))
            return;
        const wasOn = this.#isOn;
        this.#start(duration, wasOn ? null : paused => (paused ? Caffeine.onPaused(Caffeine.cardTitle(duration)) : Caffeine.onByCard(duration)));
    }

    /**
     * A duration picked from the keyboard. While off it only becomes the last-used duration
     * (the switch turns Caffeine on); while on it restarts the timer, as a click does.
     */
    chooseDuration(duration) {
        if (!DURATIONS.includes(duration))
            return;
        if (this.#isOn)
            this.selectDuration(duration);
        else
            this.#store.set('caffeine-duration', duration);
    }

    /** Alt+← (-1) or Alt+→ (+1) on the Caffeine tab: the previous or next duration, stopping at the ends. */
    moveDurationSelection(delta) {
        const current = DURATIONS.indexOf(this.lastDuration);
        const next = Math.min(Math.max(current + delta, 0), DURATIONS.length - 1);
        if (next === current)
            return;
        this.chooseDuration(DURATIONS[next]);
        this.#cardMoves++;
        this.#emit();
    }

    /** An action: "Keep awake for 1 hour" and the like. */
    keepAwake(duration) {
        if (!DURATIONS.includes(duration))
            return;
        this.#start(duration, paused => (paused ? Caffeine.onPaused(Caffeine.actionSuffix(duration)) : Caffeine.onByAction(duration)));
    }

    /** The note's Try Again: asks again (on), or turns on with the same duration (off). */
    retry() {
        if (this.#isOn) {
            this.#problem = null;
            this.#applyHolds();
            this.#emit();
        } else {
            this.#start(this.lastDuration, paused => (paused ? Caffeine.onPausedBySwitch : Caffeine.onBySwitch));
        }
    }

    turnOff() {
        if (!this.#isOn)
            return;
        this.#stop();
        this.#problem = null;
        this.#hud.toast(Caffeine.off);
        this.#emit();
    }

    /** +10 min or +1 h: from the current end, or from now if it already passed. */
    extend(minutes) {
        if (!this.#isOn || this.#endsAt === null || !EXTEND_MINUTES.includes(minutes))
            return;
        this.#endsAt = Math.max(this.#endsAt, this.#now()) + minutes * 60_000;
        this.#armExpiry();
        this.#hud.toast(Caffeine.extended(minutes));
        this.#emit();
    }

    // Options.

    /**
     * An option switch: 'keepDisplayOn', 'preventSystemSleep' or 'onlyOnAC'. The first two
     * can't both be off: turning off the last of them does nothing. Applies at once while on.
     */
    setOption(option, on) {
        const options = this.options;
        if (option === 'keepDisplayOn' && (on || options.preventSystemSleep))
            this.#store.set('keep-display-on', on === true);
        else if (option === 'preventSystemSleep' && (on || options.keepDisplayOn))
            this.#store.set('prevent-system-sleep', on === true);
        else if (option === 'onlyOnAC')
            this.#store.set('only-on-ac', on === true);
    }

    // The Caffeine tab, ready to draw.

    /** The Caffeine tab at `now` (ms) (the Mac's CaffeineScreen). */
    screen(now) {
        const options = this.options;
        const holds = this.#serviceHolds();
        const applying = holds.filter(h => h.awake !== 'refused').map(h => h.name);
        const refused = holds.filter(h => h.awake === 'refused').map(h => h.name);
        const option = (id, title, help, isOn, onlyOne) => ({
            option: id, title, help, isOn, enabled: !onlyOne, disabledHelp: onlyOne ? Caffeine.keepOneOn : null,
        });
        return {
            header: this.#header(now, holds),
            extend: this.#isOn && this.#endsAt !== null
                ? {prompt: Caffeine.needLonger, buttons: EXTEND_MINUTES.map(minutes => ({minutes, title: Caffeine.plus(minutes)}))}
                : null,
            durationsLabel: Caffeine.keepAwakeFor,
            durations: DURATIONS.map(duration => ({
                duration, title: Caffeine.cardTitle(duration), selected: duration === options.lastDuration,
                accessibleName: Caffeine.cardAccessible(duration, duration === options.lastDuration),
            })),
            options: [
                option('keepDisplayOn', Caffeine.keepDisplayOn, Caffeine.keepDisplayOnHelp, options.keepDisplayOn,
                    options.keepDisplayOn && !options.preventSystemSleep),
                option('preventSystemSleep', Caffeine.preventSystemSleep, Caffeine.preventSystemSleepHelp, options.preventSystemSleep,
                    options.preventSystemSleep && !options.keepDisplayOn),
                option('onlyOnAC', Caffeine.onlyOnAC, Caffeine.onlyOnACHelp, options.onlyOnAC, false),
            ],
            holdNote: this.#problem ? {text: Caffeine.holdNote(this.#problem), tryAgain: Caffeine.tryAgain} : null,
            heldLine: this.#isOn && applying.length ? Caffeine.alsoKeeps(applying) : null,
            refusedLine: refused.length ? Caffeine.refusedFor(refused) : null,
        };
    }

    /** Turning HeadsUp off ends Caffeine: its holds go with KeepAwake's. */
    dispose() {
        this.#scope.dispose();
    }

    // Inside.

    #now() {
        return this.#clock.now().getTime();
    }

    /**
     * Turns on with `duration`. GNOME answers later (#holdsChanged): `toast(paused)` gives the
     * toast to show once something is held, or at once while paused on battery.
     */
    #start(duration, toast = null) {
        this.#store.set('caffeine-duration', duration);
        this.#problem = null;
        this.#isOn = true;
        const minutes = MINUTES[duration];
        this.#endsAt = minutes === null ? null : this.#now() + minutes * 60_000;
        this.#pendingToast = toast;
        this.#armExpiry();
        this.#applyHolds();
        this.#holdsChanged();
    }

    #stop() {
        this.#pendingToast = null;
        this.#isOn = false;
        this.#endsAt = null;
        this.#expiry?.dispose();
        this.#expiry = null;
        this.#applyHolds();
    }

    #armExpiry() {
        this.#expiry?.dispose();
        this.#expiry = null;
        if (this.#endsAt !== null) {
            this.#expiry = this.#scope.add(this.#scheduler.at(new Date(this.#endsAt), () => {
                // Time up: off by itself, without a toast.
                this.#stop();
                this.#problem = null;
                this.#emit();
            }));
        }
    }

    #applyHolds() {
        this.#keepAwake.set(HOLDER, this.#isOn ? kindsOf(this.options) : [], Caffeine.holdName);
    }

    /**
     * GNOME answered, or the power source changed. If it refused every hold asked for,
     * Caffeine is off: the switch, the cup and the pill must not claim a computer kept awake.
     * If it refused one of two, Caffeine stays on with the other, and the note names the
     * missing one. Paused on battery, nothing is held and nothing is missing.
     */
    #holdsChanged() {
        const paused = this.#keepAwake.pausedOnBattery;
        if (paused !== this.#wasPaused) {
            this.#wasPaused = paused;
            // The pause began or ended: ask again, which retries refused holds.
            if (this.#isOn)
                this.#applyHolds();
        }
        if (this.#isOn) {
            const {held, pending, refused} = this.#keepAwake.status(HOLDER);
            if (!pending.length) {
                if (!paused) {
                    if (!refused.length)
                        this.#problem = null;
                    else if (!held.length)
                        this.#problem = 'refused';
                    else
                        this.#problem = refused.includes('display') ? 'displayRefused' : 'systemRefused';
                }
                if (this.#problem === 'refused') {
                    this.#stop();
                } else if (this.#pendingToast) {
                    this.#hud.toast(this.#pendingToast(paused));
                    this.#pendingToast = null;
                }
            }
        }
        this.#emit();
    }

    #header(now, holds) {
        const base = {switchLabel: Caffeine.switchLabel};
        if (!this.#isOn) {
            const holding = holds.filter(h => h.awake === 'holding').map(h => h.name);
            const paused = holds.filter(h => h.awake === 'pausedOnBattery').map(h => h.name);
            if (holding.length) {
                return {...base, title: Caffeine.keptAwakeBy(holding), subtitle: Caffeine.subtitleKeptAwake(holding),
                    isOn: false, chipAccent: true, pauseBadge: false, serverBadge: true};
            }
            if (paused.length) {
                return {...base, title: Caffeine.titlePaused, subtitle: Caffeine.subtitleHeldPaused(paused),
                    isOn: false, chipAccent: false, pauseBadge: true, serverBadge: false};
            }
            return {...base, title: Caffeine.titleOff, subtitle: Caffeine.subtitleOff, isOn: false, chipAccent: false, pauseBadge: false, serverBadge: false};
        }
        const left = this.#endsAt === null ? null : format.minutes((this.#endsAt - now) / 1000, 'nearest');
        const endTime = this.#endsAt === null ? null : format.time(new Date(this.#endsAt), this.#clock.timeFormat());
        if (this.pausedOnBattery) {
            return {...base, title: Caffeine.titlePaused, subtitle: left ? Caffeine.subtitlePaused(left, endTime) : Caffeine.resumesOnPower,
                isOn: true, chipAccent: false, pauseBadge: true, serverBadge: false};
        }
        return {...base, title: Caffeine.titleOn, subtitle: left ? Caffeine.subtitleLeft(left, endTime) : Caffeine.subtitleUntilOff,
            isOn: true, chipAccent: true, pauseBadge: false, serverBadge: false};
    }

    #refresh() {
        this.state = Object.freeze({
            isOn: this.#isOn, endsAt: this.#endsAt, pausedOnBattery: this.pausedOnBattery,
            lastDuration: this.lastDuration, problem: this.#problem, cardMoves: this.#cardMoves,
        });
    }

    #emit() {
        this.#refresh();
        this.emit('changed');
    }
}
