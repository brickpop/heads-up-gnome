// The Focus timer's rules (the Mac's FocusMachine; Focus spec, "State machine"): every
// transition, on wall-clock end dates. It never reads the clock: each change takes `now`.
// Dates are milliseconds since the epoch.
//
// Phases, plain frozen objects:
//   {kind: 'idle'}
//   {kind: 'focus', run}
//   {kind: 'rest', run, activity}            a break; `activity` is a break option's id
//   {kind: 'prompt', prompt}
//   {kind: 'snoozed', until, prompt}
// A run is {minutes, duration (ms), endsAt (null while paused), pausedLeft (null while it runs)}.
// A prompt is {kind: 'break', manual} ("Time for a break"; manual after Take a break now)
// or {kind: 'back'} ("Ready to get back to it?").

const MINUTE = 60_000;

export const IDLE = Object.freeze({kind: 'idle'});
export const BACK_PROMPT = Object.freeze({kind: 'back'});
export const breakPrompt = manual => Object.freeze({kind: 'break', manual});

const run = (minutes, duration, endsAt, pausedLeft) => Object.freeze({minutes, duration, endsAt, pausedLeft});

/** A run of `minutes` that starts at `now`. */
export const runningRun = (minutes, now) => run(minutes, minutes * MINUTE, now + minutes * MINUTE, null);

/** Milliseconds left at `now`, never below zero. */
export function timeLeft(r, now) {
    return r.endsAt !== null ? Math.max(0, r.endsAt - now) : r.pausedLeft ?? 0;
}

/** From 0 at the start to 1 at the end. */
export function progress(r, now) {
    if (r.duration <= 0)
        return 1;
    return Math.min(1, Math.max(0, 1 - timeLeft(r, now) / r.duration));
}

const paused = (r, now) => run(r.minutes, r.duration, null, timeLeft(r, now));
const resumed = (r, now) => run(r.minutes, r.duration, now + (r.pausedLeft ?? 0), null);

export class FocusMachine {
    /** The length of the last focus started, by hand or by auto-start; null before the first. */
    lastFocusMinutes = null;

    constructor(phase = IDLE) {
        this.phase = phase;
    }

    /** The next moment the phase changes by itself, or null when nothing runs. */
    get nextDeadline() {
        const p = this.phase;
        if (p.kind === 'focus' || p.kind === 'rest')
            return p.run.endsAt;
        return p.kind === 'snoozed' ? p.until : null;
    }

    /**
     * The length the next focus starts with after a break, on the back prompt and by
     * auto-start: the last focus's, or `standard` (the focus length setting) before any.
     */
    nextFocusMinutes(standard) {
        return this.lastFocusMinutes ?? standard;
    }

    // The user's moves.

    /** Start focus: from anywhere, a new session of `minutes`. */
    start(minutes, now) {
        this.lastFocusMinutes = minutes;
        this.#set({kind: 'focus', run: runningRun(minutes, now)});
    }

    /** Pause a focus or a break: the time left is kept, the end date dropped. */
    pause(now) {
        const p = this.phase;
        if ((p.kind === 'focus' || p.kind === 'rest') && p.run.endsAt !== null)
            this.#set({...p, run: paused(p.run, now)});
    }

    /** Resume: a new end date is now plus the time left. */
    resume(now) {
        const p = this.phase;
        if ((p.kind === 'focus' || p.kind === 'rest') && p.run.endsAt === null)
            this.#set({...p, run: resumed(p.run, now)});
    }

    /** Stop a focus or a break: back to idle, nothing counted. */
    stop() {
        if (this.phase.kind === 'focus' || this.phase.kind === 'rest')
            this.phase = IDLE;
    }

    /** Take a break now: from any phase, the break prompt. */
    takeBreakNow() {
        this.#set({kind: 'prompt', prompt: breakPrompt(true)});
    }

    /** A break of `minutes`, typed or from the focus.timer tool: from any phase, it starts now. */
    takeBreak(minutes, activity, now) {
        this.#set({kind: 'rest', run: runningRun(minutes, now), activity});
    }

    /** Start break, from the break prompt. */
    startBreak(activity, minutes, now) {
        if (this.phase.kind === 'prompt' && this.phase.prompt.kind === 'break')
            this.#set({kind: 'rest', run: runningRun(minutes, now), activity});
    }

    /** Snooze a prompt for `minutes`. */
    snooze(minutes, now) {
        if (this.phase.kind === 'prompt')
            this.#set({kind: 'snoozed', until: now + minutes * MINUTE, prompt: this.phase.prompt});
    }

    /** Show now, while snoozed: the prompt comes back at once. */
    showNow() {
        if (this.phase.kind === 'snoozed')
            this.#set({kind: 'prompt', prompt: this.phase.prompt});
    }

    /** Skip break, by hand: the back prompt, even with auto-start on. */
    skipBreak() {
        if (this.phase.kind === 'rest')
            this.#set({kind: 'prompt', prompt: BACK_PROMPT});
    }

    /** Done, from either prompt: the loop ends, back to idle. */
    doneForNow() {
        if (this.phase.kind === 'prompt')
            this.phase = IDLE;
    }

    // Time.

    /**
     * Moves on if an end date has passed: at a scheduled wake-up, or after a suspend.
     * @param {number} now
     * @param {number | null} autoStartMinutes  the focus length to start when a break ends,
     *   when "Start the next focus after a break" is on; null otherwise
     * @returns what happened, or null when nothing was due:
     *   {kind: 'focusCompleted', minutes, endedAt} · {kind: 'breakCompleted', autoStartedMinutes}
     *   · {kind: 'snoozeEnded', prompt}
     */
    advance(now, autoStartMinutes) {
        const p = this.phase;
        if (p.kind === 'focus') {
            if (p.run.endsAt === null || p.run.endsAt > now)
                return null;
            this.#set({kind: 'prompt', prompt: breakPrompt(false)});
            return {kind: 'focusCompleted', minutes: p.run.minutes, endedAt: p.run.endsAt};
        }
        if (p.kind === 'rest') {
            if (p.run.endsAt === null || p.run.endsAt > now)
                return null;
            if (autoStartMinutes !== null) {
                this.start(autoStartMinutes, now);
                return {kind: 'breakCompleted', autoStartedMinutes: autoStartMinutes};
            }
            this.#set({kind: 'prompt', prompt: BACK_PROMPT});
            return {kind: 'breakCompleted', autoStartedMinutes: null};
        }
        if (p.kind === 'snoozed') {
            if (p.until > now)
                return null;
            this.#set({kind: 'prompt', prompt: p.prompt});
            return {kind: 'snoozeEnded', prompt: p.prompt};
        }
        return null;
    }

    #set(phase) {
        this.phase = Object.freeze(phase);
    }
}
