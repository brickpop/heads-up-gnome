// FocusStore: the Focus timer (the Mac's FocusStore; Focus spec; ADR-002 §6.2, §6.7). The
// state machine, today's stats, a notification at each end, auto-open, snooze, and
// Preferences → Focus.
//
// It arms one wake-up, at the next end date, and nothing while idle. GNOME can't schedule a
// notification ahead, so the wake-up posts it when the end comes.

import {FocusMachine, progress, timeLeft} from './focusMachine.js';
import {BREAK_LENGTHS, FOCUS_LENGTHS, FocusSettingsEditor, INITIAL_OPTION_ID, SNOOZE_LENGTHS} from './focusSettings.js';
import * as format from './format.js';
import {Emitter} from './emitter.js';
import {CATEGORY_ACTIONS, notification} from './notifications.js';
import {Scope} from './scope.js';
import {Focus, Notifications} from './strings.js';

/** The id of the one Focus notification: each post replaces the last. */
export const NOTIFICATION_ID = 'focus.timer';
/** How long the HUD stays after Snooze, so the user sees the toast. */
const HIDE_AFTER_SNOOZE_MS = 600;
/** How long the HUD stays after a focus or a break starts from it. */
const HIDE_AFTER_START_MS = 1500;
const SETTINGS_KEYS = new Set(['focus-length', 'snooze-minutes', 'open-hud-on-end', 'auto-start-next-focus', 'break-options', 'focus-today']);

/** One step from index `current` by `delta`, stopping at the ends; null when it doesn't move. */
function step(current, delta, count) {
    const next = Math.min(Math.max((current < 0 ? 0 : current) + delta, 0), count - 1);
    return next === current ? null : next;
}

const isRun = phase => phase.kind === 'focus' || phase.kind === 'rest';
const isBackPrompt = phase => phase.kind === 'prompt' && phase.prompt.kind === 'back';
const isBreakPrompt = phase => phase.kind === 'prompt' && phase.prompt.kind === 'break';

export class FocusStore extends Emitter {
    #machine = new FocusMachine();
    #clock;
    #scheduler;
    #store;
    #hud;
    #notifier;
    #session;
    #screenReaderOn;
    #scope = new Scope();
    /** Writes Preferences → Focus. */
    editor;
    #wakeUp = null;
    #pendingHide = null;
    /** The break activity and length picked in the break prompt. */
    #breakActivity;
    #breakLength;
    /** The length of the focus that brought the break prompt; null after Take a break now. */
    #promptMinutes = null;
    /** The length picked on the back prompt, while it shows or is snoozed. */
    #backPromptPick = null;
    /** The snooze length picked on a prompt; null is the setting's. */
    #snoozePick = null;
    /** Card and snooze-length moves made with the keys, for the screen reader to announce. */
    #cardMoves = 0;
    #snoozeMoves = 0;
    state;

    /**
     * @param {object} ports
     * @param {import('./ports.js').Clock} ports.clock
     * @param {import('./ports.js').Scheduler} ports.scheduler
     * @param {import('./settings.js').SettingsStore} ports.store
     * @param {import('./hud.js').HudStore} ports.hudStore
     * @param {import('./ports.js').Notifier} ports.notifier
     * @param {import('./ports.js').Session} ports.session
     * @param {() => boolean} [ports.screenReaderOn]  while true, a start doesn't hide the HUD
     */
    constructor({clock, scheduler, store, hudStore, notifier, session, screenReaderOn = () => false}) {
        super();
        this.#clock = clock;
        this.#scheduler = scheduler;
        this.#store = store;
        this.#hud = hudStore;
        this.#notifier = notifier;
        this.#session = session;
        this.#screenReaderOn = screenReaderOn;
        this.editor = new FocusSettingsEditor(store);
        const options = this.settings.breakOptions;
        const initial = options.find(o => o.id === INITIAL_OPTION_ID) ?? options[0];
        this.#breakActivity = initial.id;
        this.#breakLength = initial.minutes;
        this.#scope.add(store.on('changed', key => {
            if (!SETTINGS_KEYS.has(key))
                return;
            // The picked activity was removed: the first option, with its length.
            if (!this.settings.breakOptions.some(o => o.id === this.#breakActivity))
                this.selectActivity(this.activity.id);
            this.#emit();
        }));
        this.#scope.add(notifier.onAction(answer => this.handleNotification(answer)));
        // Typing or a tab switch is the user doing something in the HUD: a pending hide
        // after a start stops.
        let {tab, input} = hudStore.state;
        this.#scope.add(hudStore.on('changed', () => {
            if (hudStore.state.tab !== tab || hudStore.state.input !== input)
                this.cancelHideSoon();
            ({tab, input} = hudStore.state);
        }));
        this.#refresh();
    }

    // State for the views.

    /** Preferences → Focus, by the rules. */
    get settings() {
        return this.editor.settings;
    }

    get phase() {
        return this.#machine.phase;
    }

    /** The focus length, the same value as Preferences → Focus → Focus length. */
    get focusLength() {
        return this.settings.focusLength;
    }

    /** The focus the back prompt starts: the one picked there, else the last focus's, else the setting. */
    get nextFocusLength() {
        return this.#backPromptPick ?? this.#machine.nextFocusMinutes(this.focusLength);
    }

    /** The back prompt's cards: the presets, plus the last focus's typed length in its place. */
    get backPromptLengths() {
        const last = this.#machine.lastFocusMinutes;
        const lengths = [...FOCUS_LENGTHS];
        if (last !== null && !lengths.includes(last))
            lengths.push(last);
        return lengths.sort((a, b) => a - b);
    }

    /** Today's completed sessions: {sessions, minutes}, zero again after local midnight. */
    get today() {
        const [day, sessions, minutes] = this.#store.state['focus-today'];
        return day === format.day(this.#clock.now()) ? {sessions, minutes} : {sessions: 0, minutes: 0};
    }

    /** The selected break activity, or the first option if it was removed. */
    get activity() {
        const options = this.settings.breakOptions;
        return options.find(o => o.id === this.#breakActivity) ?? options[0];
    }

    get breakLength() {
        return this.#breakLength;
    }

    /** The snooze length Esc uses on a prompt: the one picked, else the setting's. */
    get selectedSnoozeMinutes() {
        return this.#snoozePick ?? this.settings.snoozeMinutes;
    }

    /** The Focus tab shows a prompt, where Esc snoozes. */
    get showsPrompt() {
        return this.phase.kind === 'prompt';
    }

    /** The Focus tab shows cards that Alt+←/→ move through. */
    get showsCards() {
        return this.phase.kind === 'idle' || this.phase.kind === 'prompt';
    }

    /**
     * What the indicator, the menu and the tab dot need (the Mac's FocusSnapshot):
     * {kind: 'idle', nextLength} · {kind: 'running', run: 'focus'|'rest', endsAt}
     * · {kind: 'paused', run, left (s)} · {kind: 'prompt', prompt: 'breakDue'|'breakOver'}
     * · {kind: 'snoozed', until, prompt}
     */
    get snapshot() {
        const p = this.phase;
        const promptName = prompt => (prompt.kind === 'break' ? 'breakDue' : 'breakOver');
        switch (p.kind) {
        case 'idle': return {kind: 'idle', nextLength: this.focusLength};
        case 'focus':
        case 'rest':
            return p.run.endsAt !== null
                ? {kind: 'running', run: p.kind, endsAt: p.run.endsAt}
                : {kind: 'paused', run: p.kind, left: p.run.pausedLeft / 1000};
        case 'prompt': return {kind: 'prompt', prompt: promptName(p.prompt)};
        default: return {kind: 'snoozed', until: p.until, prompt: promptName(p.prompt)};
        }
    }

    /** The footer pill at `now` (ms): "Focus 18:42", "Break 3:10", "Snoozed 4:12", or null. */
    pill(now) {
        const p = this.phase;
        if (p.kind === 'focus')
            return Focus.pillFocus(format.clock(timeLeft(p.run, now) / 1000));
        if (p.kind === 'rest')
            return Focus.pillBreak(format.clock(timeLeft(p.run, now) / 1000));
        if (p.kind === 'snoozed')
            return Focus.pillSnoozed(format.clock((p.until - now) / 1000));
        return null;
    }

    // The user's moves.

    /**
     * Start focus. With no length, the HUD's Start: the selected length (the setting, or the
     * back prompt's pick), and the HUD hides after a moment. Returns when it ends (ms).
     */
    start(minutes) {
        if (minutes === undefined) {
            const end = this.start(isBackPrompt(this.phase) ? this.nextFocusLength : this.focusLength);
            this.hideAfterStart();
            return end;
        }
        this.#change(m => m.start(minutes, this.#now()));
        this.#hud.toast(Focus.focusStarted(minutes));
        return this.#endDate();
    }

    pause() {
        this.#change(m => m.pause(this.#now()));
    }

    resume() {
        this.#change(m => m.resume(this.#now()));
    }

    /** Pause or Resume, whichever applies. */
    togglePause() {
        if (isRun(this.phase))
            this.phase.run.endsAt === null ? this.resume() : this.pause();
    }

    stop() {
        this.#change(m => m.stop());
    }

    skipBreak() {
        this.#change(m => m.skipBreak());
    }

    /** Stop now, from either prompt: the loop ends, back to idle. */
    doneForNow() {
        this.#change(m => m.doneForNow());
    }

    showNow() {
        this.#change(m => m.showNow());
    }

    takeBreakNow() {
        this.#promptMinutes = null;
        this.#change(m => m.takeBreakNow());
    }

    /** A break of `minutes` at once, from any phase: typed `/break 7`, or the tool. Returns when it ends. */
    takeBreak(minutes) {
        this.#promptMinutes = null;
        const activity = this.activity.id;
        this.#change(m => m.takeBreak(minutes, activity, this.#now()));
        this.#hud.toast(Focus.breakStarted(minutes));
        return this.#endDate();
    }

    /** Start break, from the HUD's break prompt: the HUD hides after a moment. */
    startBreak() {
        if (this.#beginBreak())
            this.hideAfterStart();
    }

    /** Snooze from the HUD, for `minutes` or the selected length: toasts, then hides the HUD. */
    snooze(minutes = this.selectedSnoozeMinutes) {
        if (!this.showsPrompt || !SNOOZE_LENGTHS.includes(minutes))
            return;
        this.#change(m => m.snooze(minutes, this.#now()));
        this.#hud.toast(Focus.snoozed(minutes));
        this.#hideSoon(HIDE_AFTER_SNOOZE_MS);
    }

    /** A running focus's or break's button: 'stopNow', 'takeBreak' or 'skipBreak'. */
    run(action) {
        if (action === 'stopNow')
            this.stop();
        else if (action === 'takeBreak')
            this.takeBreakNow();
        else if (action === 'skipBreak')
            this.skipBreak();
    }

    /** A start from the HUD hides it after a moment, except with the screen reader on. */
    hideAfterStart() {
        if (this.#screenReaderOn())
            this.cancelHideSoon();
        else
            this.#hideSoon(HIDE_AFTER_START_MS);
    }

    /** The user did something in the HUD: it stays open. */
    cancelHideSoon() {
        this.#pendingHide?.dispose();
        this.#pendingHide = null;
    }

    /** Picks a break activity; the break length becomes its default. */
    selectActivity(id) {
        const option = this.settings.breakOptions.find(o => o.id === id);
        if (!option)
            return;
        this.cancelHideSoon();
        this.#breakActivity = option.id;
        this.#breakLength = option.minutes;
        this.#emit();
    }

    setBreakLength(minutes) {
        if (!BREAK_LENGTHS.includes(minutes))
            return;
        this.cancelHideSoon();
        this.#breakLength = minutes;
        this.#emit();
    }

    /** Picks the focus length on the back prompt, one of `backPromptLengths`. */
    setNextFocusLength(minutes) {
        if (!isBackPrompt(this.phase) || !this.backPromptLengths.includes(minutes))
            return;
        this.cancelHideSoon();
        this.#backPromptPick = minutes;
        this.#emit();
    }

    /** ← → in the snooze group: picks a length without snoozing. The setting stays. */
    selectSnooze(minutes) {
        if (!this.showsPrompt || !SNOOZE_LENGTHS.includes(minutes))
            return;
        this.cancelHideSoon();
        this.#snoozePick = minutes;
        this.#emit();
    }

    /**
     * Alt+Shift+← (-1) or → (+1) on a prompt: the previous or next snooze length, stopping at
     * the ends. False where there is no prompt, so the key goes on to the prompt field.
     */
    moveSnoozeSelection(delta) {
        if (!this.showsPrompt)
            return false;
        const next = step(SNOOZE_LENGTHS.indexOf(this.selectedSnoozeMinutes), delta, SNOOZE_LENGTHS.length);
        if (next !== null) {
            this.selectSnooze(SNOOZE_LENGTHS[next]);
            this.#snoozeMoves++;
            this.#emit();
        }
        return true;
    }

    /**
     * Alt+← (-1) or Alt+→ (+1): the previous or next card, stopping at the ends. Idle and the
     * back prompt move among the focus lengths, the break prompt among the break options.
     * False where there are no cards.
     */
    moveCardSelection(delta) {
        const p = this.phase;
        if (p.kind === 'idle') {
            const next = step(FOCUS_LENGTHS.indexOf(this.focusLength), delta, FOCUS_LENGTHS.length);
            if (next === null)
                return true;
            this.setFocusLength(FOCUS_LENGTHS[next]);
        } else if (isBackPrompt(p)) {
            const lengths = this.backPromptLengths;
            const next = step(lengths.indexOf(this.nextFocusLength), delta, lengths.length);
            if (next === null)
                return true;
            this.setNextFocusLength(lengths[next]);
        } else if (isBreakPrompt(p)) {
            const options = this.settings.breakOptions;
            const next = step(options.findIndex(o => o.id === this.activity.id), delta, options.length);
            if (next === null)
                return true;
            this.selectActivity(options[next].id);
        } else {
            return false;
        }
        // After the change: the view announces the card selected when this changes.
        this.#cardMoves++;
        this.#emit();
        return true;
    }

    /**
     * Ctrl+Enter: the primary button of what the tab shows. False while a focus or a break
     * runs, which has none.
     */
    runPrimaryAction() {
        const p = this.phase;
        if (p.kind === 'idle' || isBackPrompt(p))
            this.start();
        else if (isBreakPrompt(p))
            this.startBreak();
        else if (p.kind === 'snoozed')
            this.showNow();
        else
            return false;
        return true;
    }

    // Preferences → Focus: in `editor`. The idle cards set the focus length.

    setFocusLength(minutes) {
        this.editor.setFocusLength(minutes);
    }

    // Notifications.

    /**
     * An answer to a notification. Ignored while the screen is locked (G2), and for another
     * subject's notification. A button that no longer fits the timer (an old notification)
     * does nothing; a click on the body opens the HUD on Focus.
     */
    handleNotification({id, category, action}) {
        if (id !== NOTIFICATION_ID || this.#session.locked)
            return;
        this.#advance();
        if (action === null) {
            this.#hud.focus('focus');
            return;
        }
        if (!(CATEGORY_ACTIONS[category] ?? []).includes(action))
            return;
        const p = this.phase;
        // Answers from a notification don't hide the HUD: it may be open for something else.
        if (action === 'start-break' && isBreakPrompt(p))
            this.#beginBreak();
        else if (action === 'start-focus' && isBackPrompt(p))
            this.start(this.nextFocusLength);
        else if (action === 'done' && p.kind === 'prompt')
            this.doneForNow();
        else if (action === 'snooze' && p.kind === 'prompt')
            this.#change(m => m.snooze(this.settings.snoozeMinutes, this.#now()));
        else if (action === 'stop' && p.kind === 'focus')
            this.stop();
    }

    // The Focus tab, ready to draw.

    /** The Focus tab at `now` (ms): every string and choice the view needs (the Mac's FocusScreen). */
    screen(now) {
        const p = this.phase;
        switch (p.kind) {
        case 'idle':
            return {kind: 'idle', ...this.#idleScreen()};
        case 'focus': {
            const breakAt = p.run.endsAt ?? now + timeLeft(p.run, now);
            return {
                kind: 'running',
                ...this.#runningScreen(p.run, now, p.run.endsAt === null ? Focus.focusPaused : Focus.focusing,
                    Focus.sessionSubtitle(p.run.minutes, format.time(new Date(breakAt), this.#clock.timeFormat())),
                    'stopNow', 'takeBreak'),
            };
        }
        case 'rest':
            return {
                kind: 'running',
                ...this.#runningScreen(p.run, now, p.run.endsAt === null ? Focus.breakPaused : Focus.breakLabel(this.activity.label),
                    Focus.breakSubtitle, null, 'skipBreak'),
            };
        case 'prompt':
            return p.prompt.kind === 'break' ? {kind: 'breakPrompt', ...this.#breakPromptScreen(p.prompt.manual)} : {
                kind: 'backPrompt',
                label: Focus.breakFinished,
                title: Focus.readyToGetBack,
                today: this.#todayStats(),
                lengths: this.backPromptLengths.map(minutes => this.#lengthCard(minutes,
                    FOCUS_LENGTHS.includes(minutes) ? Focus.lengthHint(minutes) : Focus.lastFocusHint,
                    minutes === this.nextFocusLength)),
                snooze: this.#snoozeGroup(),
                start: Focus.startFocus,
            };
        default:
            return {
                kind: 'snoozed',
                label: Focus.snoozedLabel,
                title: Focus.promptReturns(format.clock((p.until - now) / 1000)),
                showNow: Focus.showNow,
            };
        }
    }

    /** Turning HeadsUp off ends the timer: its notification goes too, its buttons would act on nothing. */
    dispose() {
        this.#scope.dispose();
        this.#notifier.withdraw(NOTIFICATION_ID);
    }

    // Inside.

    #now() {
        return this.#clock.now().getTime();
    }

    #endDate() {
        return isRun(this.phase) ? this.phase.run.endsAt ?? this.#now() : this.#now();
    }

    /** Starts the break the prompt has picked, if it shows. */
    #beginBreak() {
        if (!isBreakPrompt(this.phase))
            return false;
        const minutes = this.#breakLength;
        const activity = this.activity.id;
        this.#change(m => m.startBreak(activity, minutes, this.#now()));
        this.#hud.toast(Focus.breakStarted(minutes));
        return true;
    }

    /** Hides the open HUD after `ms`, unless the user does something in it first. */
    #hideSoon(ms) {
        this.cancelHideSoon();
        if (!this.#hud.state.visible)
            return;
        const handle = this.#scope.add(this.#scheduler.at(new Date(this.#now() + ms), () => {
            handle.dispose();
            this.#pendingHide = null;
            this.#hud.hide();
        }));
        this.#pendingHide = handle;
    }

    /** Applies a move, then brings the wake-up and the notification up to date. */
    #change(move) {
        this.cancelHideSoon();
        const before = this.phase;
        move(this.#machine);
        this.#phaseChanged(before);
    }

    #phaseChanged(before) {
        const p = this.phase;
        // A pick on the back prompt lasts while it shows or is snoozed.
        if (!isBackPrompt(p) && !(p.kind === 'snoozed' && p.prompt.kind === 'back'))
            this.#backPromptPick = null;
        // A snooze pick lasts while its prompt shows.
        this.#snoozePick = null;
        this.#armWakeUp();
        // A prompt's notification goes once the prompt is answered or gives way.
        if (before.kind === 'prompt' && !(p.kind === 'prompt' && p.prompt === before.prompt))
            this.#notifier.withdraw(NOTIFICATION_ID);
        this.#emit();
    }

    #armWakeUp() {
        this.#wakeUp?.dispose();
        this.#wakeUp = null;
        const deadline = this.#machine.nextDeadline;
        if (deadline !== null)
            this.#wakeUp = this.#scope.add(this.#scheduler.at(new Date(deadline), () => this.#advance()));
    }

    /** Moves on if an end date has passed, posts its notification, and auto-opens. */
    #advance() {
        const before = this.phase;
        const settings = this.settings;
        const autoStart = settings.autoStartNextFocus ? this.#machine.nextFocusMinutes(settings.focusLength) : null;
        const event = this.#machine.advance(this.#now(), autoStart);
        if (!event) {
            this.#armWakeUp();
            return;
        }
        if (event.kind === 'focusCompleted') {
            this.#recordSession(event.minutes, event.endedAt);
            this.#promptMinutes = event.minutes;
            this.#post('focus.end', Notifications.focusDoneTitle(event.minutes), Notifications.focusDoneBody);
            this.#autoOpen(Focus.focusDoneAnnouncement);
        } else if (event.kind === 'breakCompleted' && event.autoStartedMinutes !== null) {
            this.#post('break.autostart', Notifications.breakOverTitle, Notifications.focusStartedBody(event.autoStartedMinutes));
            this.#hud.toast(Focus.focusStarted(event.autoStartedMinutes));
        } else if (event.kind === 'breakCompleted') {
            this.#post('break.end', Notifications.breakOverTitle, Notifications.breakOverBody);
            this.#autoOpen(Focus.breakOverAnnouncement);
        } else if (event.prompt.kind === 'break') {
            this.#post('focus.end', Notifications.snoozeOverBreakTitle, Notifications.snoozeOverBreakBody(this.#promptMinutes));
            this.#autoOpen(Focus.snoozeOverBreakAnnouncement);
        } else {
            this.#post('break.end', Notifications.breakOverTitle, Notifications.snoozeOverBackBody);
            this.#autoOpen(Focus.breakOverAnnouncement);
        }
        this.#phaseChanged(before);
    }

    #post(category, title, body) {
        this.#notifier.post(notification(NOTIFICATION_ID, category, title, body));
    }

    /** Brings the prompt to the user when the setting is on; the HUD decides how. */
    #autoOpen(announcement) {
        if (this.settings.openHudOnEnd)
            this.#hud.autoOpen('focus', announcement);
    }

    /** Counts a session on the local day it ended. */
    #recordSession(minutes, endedAt) {
        const day = format.day(new Date(endedAt));
        const [saved, sessions, total] = this.#store.state['focus-today'];
        this.#store.set('focus-today', saved === day ? [day, sessions + 1, total + minutes] : [day, 1, minutes]);
    }

    #refresh() {
        this.state = Object.freeze({
            phase: this.phase,
            activity: this.activity.id,
            breakLength: this.#breakLength,
            nextFocusLength: this.nextFocusLength,
            selectedSnoozeMinutes: this.selectedSnoozeMinutes,
            cardMoves: this.#cardMoves,
            snoozeMoves: this.#snoozeMoves,
        });
    }

    #emit() {
        this.#refresh();
        this.emit('changed');
    }

    #todayStats() {
        const {sessions, minutes} = this.today;
        return Focus.todayStats(sessions, minutes === 0 ? '0m' : format.minutes(minutes * 60, 'nearest'));
    }

    #idleScreen() {
        return {
            label: Focus.idleLabel,
            timer: format.clock(this.focusLength * 60),
            today: this.#todayStats(),
            lengths: FOCUS_LENGTHS.map(m => this.#lengthCard(m, Focus.lengthHint(m), m === this.focusLength)),
            breaksOffer: Focus.breaksOffer(this.settings.breakOptions.map(o => o.label)),
            start: Focus.startFocus,
        };
    }

    #runningScreen(run, now, label, subtitle, stop, end) {
        const left = timeLeft(run, now) / 1000;
        const paused = run.endsAt === null;
        const button = action => action && {
            action,
            title: {stopNow: Focus.stopNow, takeBreak: Focus.takeBreak, skipBreak: Focus.skipBreak}[action],
            glyph: {stopNow: 'stop', takeBreak: 'droplet-circle', skipBreak: 'skip'}[action],
        };
        return {
            label,
            timer: format.clock(left),
            timerAccessible: Focus.timeLeftAccessible(format.spokenMinutes(left, 'up')),
            subtitle,
            progress: progress(run, now),
            stop: button(stop),
            end: button(end),
            pauseTitle: paused ? Focus.resume : Focus.pause,
            pauseGlyph: paused ? 'play-circle' : 'pause',
        };
    }

    #breakPromptScreen(manual) {
        const today = this.today;
        const selected = this.activity.id;
        let label;
        if (this.#promptMinutes !== null && !manual)
            label = Focus.sessionDone(this.#promptMinutes, today.sessions);
        else if (today.sessions === 0)
            label = Focus.noSessionsYet;
        else
            label = this.#todayStats();
        return {
            label,
            title: Focus.timeForABreak,
            options: this.settings.breakOptions.map(o => ({
                id: o.id, label: o.label, glyph: o.icon, length: Focus.minutes(o.minutes), selected: o.id === selected,
                accessibleName: Focus.cardAccessible(o.label, Focus.minutes(o.minutes), o.id === selected),
            })),
            lengths: BREAK_LENGTHS.map(m => ({
                minutes: m, title: Focus.lengthChoice(m), selected: m === this.#breakLength, accessibleName: Focus.lengthAccessible(m),
            })),
            selectedLength: this.#breakLength,
            snooze: this.#snoozeGroup(),
            startBreak: Focus.startBreak,
        };
    }

    #lengthCard(minutes, hint, selected) {
        const title = Focus.minutes(minutes);
        return {minutes, title, hint, selected, accessibleName: Focus.cardAccessible(title, hint, selected)};
    }

    #snoozeGroup() {
        return {
            label: Focus.snooze,
            choices: SNOOZE_LENGTHS.map(m => ({
                minutes: m, title: Focus.snoozeChoice(m), selected: m === this.selectedSnoozeMinutes, accessibleName: Focus.snoozeAccessible(m),
            })),
            stopNow: Focus.stopNow,
            stopNowHelp: Focus.stopNowHelp,
        };
    }
}
