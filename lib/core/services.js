// ServiceStore: the services the user defined, the processes HeadsUp started, their logs (the
// Mac's ServiceStore; Services spec; ADR-002 §6.4, §6.5).
//
// Each run is our child in its own systemd scope (Processes port). Stop stops the scope:
// systemd sends SIGTERM to every process in it, SIGKILL 3 s later. An exit nobody asked for
// is `failed`, with a notification and the Services tab's red dot until the user opens it; with
// Restart on, it starts again after 1, 2, 5, 10, 30 s, up to 5 times in a row. Every exit stops
// the run's scope first, so children it left behind never run beside the next start (N4b).
//
// States, by id: {kind: 'stopped'} · {kind: 'starting', pid, since} · {kind: 'running', pid,
// since, port} · {kind: 'waitingToRestart', attempt, at, lastExit} · {kind: 'failed', exitCode,
// at, gaveUpSince}. Times are ms.

import {Emitter} from './emitter.js';
import * as format from './format.js';
import {DRAWER_LINES, LogRing, OUTPUT_TICK_MS, OutputReader, formatLogLine, logTime} from './logRing.js';
import {notification} from './notifications.js';
import {Scope} from './scope.js';
import {showControls} from './sanitize.js';
import {KEEP_AWAKE, displayName, firstProblem, problems, readDefinition, writeDefinition} from './serviceDefinition.js';
import {Services, ListForm} from './strings.js';

/** A service with no port set counts as running after this long (ms). */
const START_WINDOW = 3000;
/** A service with a port set, alive this long, counts as running while its port is silent. */
const PORT_WINDOW = 30_000;
const PORT_CHECK_STARTING = 1000;
const PORT_CHECK_SILENT = 5000;
/** When a service with no port set is asked which port it listens on (ms after start). */
const FIND_PORT_AT = [2000, 10_000];
/** Automatic restarts in a row before HeadsUp gives up: the 6th stop isn't restarted. */
export const MAX_RESTARTS = 5;
const RESTART_DELAYS = [1000, 2000, 5000, 10_000, 30_000];
/** A run this long starts the restart count over. */
const STREAK_RESET = 5 * 60_000;
const NOTIFICATION_PREFIX = 'service.failed:';
const STOPPED = Object.freeze({kind: 'stopped'});

const isLive = state => state.kind === 'starting' || state.kind === 'running';
const holdsWhile = state => isLive(state) || state.kind === 'waitingToRestart';
const holder = id => `service:${id}`;

/** How long an exited run's output is still read before its exit line is logged. */
const DRAIN = 1000;

export class ServiceStore extends Emitter {
    #ports;
    #scope = new Scope();
    /** id → state. */
    #runtime = new Map();
    /** id → LogRing. */
    #logs = new Map();
    /** id → the live run: {handle, source (its output's reading), timers: Scope}. */
    #runs = new Map();
    /** Services the user asked to stop: their exit isn't a failure. */
    #stopping = new Set();
    #restartAfterStop = new Set();
    /** id → {restarts, since}: the automatic restarts of the current streak. */
    #streaks = new Map();
    /** id → the wake-up of a waiting restart. */
    #restartWaits = new Map();
    /** Runs that are automatic restarts, not a user's start. */
    #automatic = new Set();
    /** Running services whose set port hasn't answered yet. */
    #silentPorts = new Set();
    /** id → 'holding' | 'pausedOnBattery' | 'refused': each Keep awake hold, while it should hold. */
    #awake = new Map();
    /** Live services with a limit whose user has been away that long: no hold until they're back. */
    #away = new Set();
    /** id → the idle or active watch of its limit. */
    #activity = new Map();
    /** Services whose user just came back: their next hold logs "you're back". */
    #back = new Set();
    /** Every run's output, read under the shared budget (N2). */
    #reader = new OutputReader();
    #tick = null;
    #dirty = false;
    #shell = null;
    openLogs = null;
    failureUnseen = false;
    state;

    /**
     * @param {object} ports
     * @param {import('./ports.js').Clock} ports.clock
     * @param {import('./ports.js').Scheduler} ports.scheduler
     * @param {import('./settings.js').SettingsStore} ports.store
     * @param {import('./ports.js').Processes} ports.processes
     * @param {import('./ports.js').PortProbe} ports.portProbe
     * @param {import('./ports.js').Notifier} ports.notifier
     * @param {import('./ports.js').Idle} ports.idle
     * @param {import('./ports.js').Session} ports.session
     * @param {import('./keepAwake.js').KeepAwake} ports.keepAwake
     * @param {import('./hud.js').HudStore} ports.hudStore
     * @param {import('./ports.js').Links} ports.links
     */
    constructor(ports) {
        super();
        this.#ports = ports;
        this.#scope.add(ports.store.on('changed', key => key === 'services' && this.#definitionsChanged()));
        this.#scope.add(ports.keepAwake.on('changed', () => this.#awakeChanged()));
        this.#scope.add(ports.notifier.onAction(answer => this.#answered(answer)));
        this.#refresh();
    }

    // State.

    /** The definitions, in list order, each read by the rules. */
    get definitions() {
        const seen = new Set();
        return (this.#ports.store.state.services ?? []).map(readDefinition).filter(d => !seen.has(d.id) && seen.add(d.id));
    }

    definition(id) {
        return this.definitions.find(d => d.id === id) ?? null;
    }

    stateOf(id) {
        return this.#runtime.get(id) ?? STOPPED;
    }

    logLines(id) {
        return this.#logs.get(id)?.lines ?? [];
    }

    /** What the indicator, the menu and the tab dot need: {running, starting, failed}. */
    get snapshot() {
        const counts = {running: 0, starting: 0, failed: 0};
        for (const s of this.#runtime.values()) {
            if (s.kind === 'running')
                counts.running++;
            else if (s.kind === 'starting' || s.kind === 'waitingToRestart')
                counts.starting++;
            else if (s.kind === 'failed')
                counts.failed++;
        }
        return counts;
    }

    /** Live services, in list order: what Stop All Services stops. */
    get liveServices() {
        return this.definitions.filter(d => isLive(this.stateOf(d.id)));
    }

    /** The services whose hold applies, in list order, for Caffeine, the indicator and the menu. */
    get serviceHolds() {
        return this.definitions.filter(d => this.#awake.has(d.id)).map(d => ({name: displayName(d), awake: this.#awake.get(d.id)}));
    }

    /** `http://localhost:<port>` of a running service with a known port, else null. */
    localUrl(id) {
        const s = this.stateOf(id);
        return s.kind === 'running' && s.port ? `http://localhost:${s.port}` : null;
    }

    // Start, stop, restart.

    /** At enable: every HeadsUp scope left behind stops (N4b), then the autostart services start. */
    async enable() {
        await this.#ports.processes.stopAll();
        if (this.#scope.disposed)
            return;
        // A list left by a shell that crashed (no dispose) is replaced.
        this.#writeRunning();
        for (const d of this.definitions) {
            if (d.autostart && !firstProblem(d)) {
                this.#userStarts(d.id);
                this.#launch(d, false);
            }
        }
    }

    /** Start. A service that breaks a rule can't start until it is fixed. */
    start(id) {
        const d = this.definition(id);
        if (!d || firstProblem(d) || isLive(this.stateOf(id)))
            return;
        this.#userStarts(id);
        this.#launch(d, true);
    }

    /** Stop: the run's scope stops. While a restart waits, it cancels the restart. */
    stop(id) {
        const d = this.definition(id);
        if (this.#cancelRestart(id)) {
            if (d)
                this.#ports.hudStore.toast(Services.stopped(displayName(d)));
            return;
        }
        if (!isLive(this.stateOf(id)))
            return;
        this.#stopRun(id);
        if (d)
            this.#ports.hudStore.toast(Services.stopped(displayName(d)));
    }

    /** Restart a live service: stop it, and start it again once it has exited. */
    restart(id) {
        if (!isLive(this.stateOf(id))) {
            this.start(id);
            return;
        }
        this.#userStarts(id);
        this.#restartAfterStop.add(id);
        this.stop(id);
    }

    /** Start or Stop, the row's button. */
    toggleRun(id) {
        const s = this.stateOf(id);
        if (isLive(s) || s.kind === 'waitingToRestart')
            this.stop(id);
        else
            this.start(id);
    }

    /** Stop All Services (the menu): every service the store knows, and any waiting restart. */
    stopAll() {
        for (const id of [...this.#restartWaits.keys()])
            this.#cancelRestart(id);
        for (const d of this.liveServices)
            this.#stopRun(d.id);
        this.#ports.hudStore.toast(Services.stoppedAll);
    }

    /**
     * A running service's port, in the browser. The address is read again now, from the
     * number alone, so a row drawn earlier can't open anything else. The HUD closes.
     */
    openInBrowser(id) {
        const url = this.localUrl(id);
        if (!url)
            return;
        this.#ports.links.open(url);
        this.#ports.hudStore.hide();
    }

    // Logs.

    /** The Logs button: opens this service's drawer, or closes it. One at a time. */
    toggleLogs(id) {
        this.openLogs = this.openLogs === id ? null : id;
        this.#emit();
    }

    clearLogs(id) {
        this.#logs.get(id)?.clear();
        this.#emit();
    }

    /** The whole log as text, one "14:03:27  line" per line: Copy All. */
    logText(id) {
        return (this.#logs.get(id)?.lines ?? []).map(formatLogLine).join('\n');
    }

    /** The user opened the Services tab: a failure is seen, and the red dot goes. */
    sawServices() {
        if (this.failureUnseen) {
            this.failureUnseen = false;
            this.#emit();
        }
    }

    /** Show Logs, from a notification: Services opens with that service's drawer. */
    showLogs(id) {
        if (!this.definition(id))
            return;
        this.openLogs = id;
        this.failureUnseen = false;
        this.#ports.hudStore.focus('services');
        this.#emit();
    }

    // The tab, ready to draw.

    /** The Services tab at `now` (ms) (the Mac's ServicesScreen). */
    screen(now) {
        const definitions = this.definitions;
        return {
            label: Services.tabLabel(this.snapshot.running),
            note: definitions.length ? Services.tabNote : null,
            edit: Services.edit,
            empty: definitions.length ? null : {title: Services.emptyTitle, text: Services.emptyText, add: Services.addService},
            rows: definitions.map(d => this.#row(d, now)),
        };
    }

    /** Turning HeadsUp off: every HeadsUp scope stops, the logs and holds go (memory only). */
    dispose() {
        this.#scope.dispose();
        for (const run of this.#runs.values()) {
            run.source.stop();
            run.timers.dispose();
        }
        for (const wait of this.#restartWaits.values())
            wait.dispose();
        for (const watch of this.#activity.values())
            watch.dispose();
        this.#tick?.dispose();
        this.#ports.processes.stopAll();
        if (this.#ports.store.state['running-services'].length)
            this.#ports.store.set('running-services', []);
        for (const id of this.#awake.keys())
            this.#ports.keepAwake.set(holder(id), [], '');
        this.#runs.clear();
        this.#logs.clear();
    }

    // Inside: runs.

    #now() {
        return this.#ports.clock.now().getTime();
    }

    #at(ms, fn, scope = this.#scope) {
        const handle = scope.add(this.#ports.scheduler.at(new Date(this.#now() + ms), () => {
            handle.dispose();
            fn();
        }));
        return handle;
    }

    /** Starts `d` in the user's shell, chosen once (the first start logs a fallback). */
    #launch(d, toast) {
        const id = d.id;
        const since = this.#now();
        this.#silentPorts.delete(id);
        this.#log(id, Services.commandLine(d.command));
        this.#log(id, Services.starting);
        if (!this.#shell) {
            this.#shell = this.#ports.processes.loginShell();
            if (this.#shell.fallback)
                this.#log(id, Services.shellFallback(this.#shell.fallback));
        }
        let handle;
        try {
            handle = this.#ports.processes.start({id, command: d.command, cwd: d.cwd, env: d.env, shell: this.#shell.shell});
        } catch (error) {
            this.#automatic.delete(id);
            this.#log(id, Services.couldNotStart(String(error.message ?? error).slice(0, 200)));
            this.#runtime.set(id, {kind: 'failed', exitCode: -1, at: this.#now(), gaveUpSince: null});
            this.openLogs = id;
            this.#syncHold(id);
            this.#emit();
            return;
        }
        const pid = handle.pid;
        const timers = this.#scope.child();
        const ring = this.#ring(id);
        const source = this.#reader.add(handle.output, bytes => {
            ring.appendOutput(bytes, this.#now());
            this.#dirty = true;
        });
        this.#runs.set(id, {handle, source, timers});
        this.#runtime.set(id, {kind: 'starting', pid, since});
        this.#syncHold(id);
        if (toast)
            this.#ports.hudStore.toast(Services.started(displayName(d)));
        this.#ensureTick();
        handle.exited.then(exit => this.#exited(id, handle, exit));
        if (d.port) {
            // Starting until the port answers; after 30 s alive, running but silent.
            this.#checkPort(id, pid, d.port, PORT_CHECK_STARTING);
            this.#at(PORT_WINDOW, () => {
                const s = this.stateOf(id);
                if (s.kind === 'starting' && s.pid === pid) {
                    this.#runtime.set(id, {kind: 'running', pid, since: s.since, port: d.port});
                    this.#silentPorts.add(id);
                    this.#emit();
                }
            }, timers);
        } else {
            this.#at(START_WINDOW, () => {
                const s = this.stateOf(id);
                if (s.kind === 'starting' && s.pid === pid) {
                    this.#runtime.set(id, {kind: 'running', pid, since: s.since, port: null});
                    this.#emit();
                }
            }, timers);
            for (const delay of FIND_PORT_AT)
                this.#at(delay, () => this.#findPort(id, pid), timers);
        }
        this.#emit();
    }

    #checkPort(id, pid, port, delay) {
        const timers = this.#runs.get(id)?.timers;
        if (!timers)
            return;
        this.#at(delay, async () => {
            const answers = await this.#ports.portProbe.answers(port);
            const s = this.stateOf(id);
            if (!isLive(s) || s.pid !== pid)
                return;
            if (answers) {
                this.#runtime.set(id, {kind: 'running', pid, since: s.since, port});
                this.#silentPorts.delete(id);
                this.#emit();
                return;
            }
            this.#checkPort(id, pid, port, this.#silentPorts.has(id) ? PORT_CHECK_SILENT : PORT_CHECK_STARTING);
        }, timers);
    }

    /** Looks for the port of a service with none set: one that answers means it is up. */
    async #findPort(id, pid) {
        const port = await this.#ports.portProbe.listening(pid);
        const s = this.stateOf(id);
        if (port && isLive(s) && s.pid === pid && !s.port) {
            this.#runtime.set(id, {kind: 'running', pid, since: s.since, port});
            this.#emit();
        }
    }

    #stopRun(id) {
        const run = this.#runs.get(id);
        if (!run)
            return;
        this.#stopping.add(id);
        run.handle.stop();
    }

    /** The read budget's tick: the outputs read in turn; the views hear of new output. */
    #ensureTick() {
        if (this.#tick)
            return;
        this.#tick = this.#scope.add(this.#ports.scheduler.every(OUTPUT_TICK_MS, () => {
            this.#reader.tick();
            if (this.#dirty) {
                this.#dirty = false;
                this.#emit();
            }
            if (!this.#reader.size) {
                this.#tick.dispose();
                this.#tick = null;
            }
        }));
    }

    /**
     * The run ended. The state changes at once; its output is still read until its end or for
     * DRAIN, then the exit line is logged after the last output (Nick 1), with what follows it.
     */
    #exited(id, handle, exit) {
        const run = this.#runs.get(id);
        if (!run || run.handle !== handle || this.#scope.disposed)
            return;
        // Children left behind stop with the run's scope, before anything else (N4b).
        handle.stop();
        run.timers.dispose();
        this.#runs.delete(id);
        const now = this.#now();
        const before = this.stateOf(id);
        const d = this.definition(id);
        this.#silentPorts.delete(id);
        const after = [];
        const log = text => after.push(() => this.#log(id, text));
        log('code' in exit ? Services.exited(exit.code) : Services.killed(Services.signalName(exit.signal)));
        const code = 'code' in exit ? exit.code : 128 + exit.signal;
        if (!d) {
            this.#stopping.delete(id);
            this.#restartAfterStop.delete(id);
            this.#drain(id, run.source, () => this.#forget(id));
            return;
        }
        const wasStarting = before.kind === 'starting';
        const wasAutomatic = this.#automatic.delete(id);
        if (this.#stopping.delete(id)) {
            this.#runtime.set(id, STOPPED);
            this.#syncHold(id);
            if (this.#restartAfterStop.delete(id))
                after.push(() => this.#launch(d, true));
        } else if (d.restartOnExit && (!wasStarting || wasAutomatic)) {
            // A user's start that fails within its start window stays failed: a typo doesn't loop.
            this.#restartAfterExit(d, code, isLive(before) ? before.since : null, now, log);
        } else {
            this.#runtime.set(id, {kind: 'failed', exitCode: code, at: now, gaveUpSince: null});
            this.failureUnseen = true;
            // Failed to start: its logs open by themselves.
            if (wasStarting)
                this.openLogs = id;
            this.#ports.notifier.post(notification(NOTIFICATION_PREFIX + id, 'service.failed', Services.failedTitle(displayName(d)), Services.failedBody(code)));
            this.#syncHold(id);
        }
        this.#emit();
        this.#drain(id, run.source, () => after.forEach(step => step()));
    }

    /** Reads `source` until its end or for DRAIN, then flushes the log and runs `then`. */
    #drain(id, source, then) {
        let finished = false;
        const finish = () => {
            if (finished || this.#scope.disposed)
                return;
            finished = true;
            timer.dispose();
            source.stop();
            this.#logs.get(id)?.flush(this.#now());
            then();
            this.#emit();
        };
        const timer = this.#at(DRAIN, finish);
        source.done.then(finish);
        source.drain();
    }

    // Inside: restart if it stops.

    #restartAfterExit(d, code, runSince, now, log) {
        const id = d.id;
        const streak = this.#streaks.get(id) ?? {restarts: 0, since: now};
        if (runSince !== null && now - runSince >= STREAK_RESET)
            streak.restarts = 0;
        if (streak.restarts === 0)
            streak.since = now;
        if (streak.restarts >= MAX_RESTARTS) {
            this.#giveUp(d, code, streak.since, now, log);
            return;
        }
        streak.restarts++;
        this.#streaks.set(id, streak);
        const attempt = streak.restarts;
        const delay = RESTART_DELAYS[attempt - 1];
        this.#runtime.set(id, {kind: 'waitingToRestart', attempt, at: now + delay, lastExit: code});
        log(Services.restartingIn(delay / 1000, attempt, MAX_RESTARTS));
        this.#restartWaits.set(id, this.#at(delay, () => this.#runRestart(id, attempt)));
        this.#syncHold(id);
    }

    #runRestart(id, attempt) {
        const s = this.stateOf(id);
        const d = this.definition(id);
        this.#restartWaits.delete(id);
        if (s.kind !== 'waitingToRestart' || s.attempt !== attempt || !d)
            return;
        this.#runtime.delete(id);
        const problem = firstProblem(d);
        if (problem) {
            this.#streaks.delete(id);
            this.#log(id, Services.cantStart(problem));
            this.#syncHold(id);
            this.#emit();
            return;
        }
        this.#automatic.add(id);
        this.#launch(d, false);
    }

    #giveUp(d, code, since, now, log) {
        const id = d.id;
        this.#streaks.delete(id);
        this.#runtime.set(id, {kind: 'failed', exitCode: code, at: now, gaveUpSince: since});
        this.failureUnseen = true;
        this.openLogs = id;
        log(Services.gaveUpLog(MAX_RESTARTS));
        this.#ports.notifier.post(notification(NOTIFICATION_PREFIX + id, 'service.failed', Services.gaveUpTitle(displayName(d)), Services.gaveUpBody(MAX_RESTARTS)));
        this.#syncHold(id);
    }

    /** A start by the user: the restart count starts over, and a waiting restart gives way. */
    #userStarts(id) {
        this.#streaks.delete(id);
        this.#automatic.delete(id);
        const wait = this.#restartWaits.get(id);
        if (wait) {
            wait.dispose();
            this.#restartWaits.delete(id);
            this.#runtime.delete(id);
        }
    }

    /** Stop or Restart switched off while a restart waits: it doesn't run. False when none waits. */
    #cancelRestart(id) {
        if (this.stateOf(id).kind !== 'waitingToRestart')
            return false;
        this.#restartWaits.get(id)?.dispose();
        this.#restartWaits.delete(id);
        this.#streaks.delete(id);
        this.#runtime.set(id, STOPPED);
        this.#log(id, Services.restartCancelled);
        this.#syncHold(id);
        this.#emit();
        return true;
    }

    // Inside: keep awake.

    /** Asks for or releases the service's hold to match its state, its choice and the user's activity. */
    #syncHold(id) {
        const d = this.definition(id);
        const wants = d && d.keepAwake !== 'off' && holdsWhile(this.stateOf(id)) && !this.#away.has(id);
        this.#ports.keepAwake.set(holder(id), wants ? ['system'] : [], `${displayName(d ?? {name: ''})}`);
        this.#watchActivity(id);
        this.#awakeChanged();
    }

    /** The holds' states from KeepAwake, each change logged once (UX flags §3). */
    #awakeChanged() {
        let changed = false;
        for (const d of this.definitions) {
            const id = d.id;
            const before = this.#awake.get(id) ?? null;
            const {held, pending, refused} = this.#ports.keepAwake.status(holder(id));
            const wants = d.keepAwake !== 'off' && holdsWhile(this.stateOf(id)) && !this.#away.has(id);
            let now = null;
            if (wants) {
                if (this.#ports.keepAwake.pausedOnBattery)
                    now = 'pausedOnBattery';
                else if (held.length)
                    now = 'holding';
                else if (refused.length)
                    now = 'refused';
                else if (pending.length)
                    now = before;
            }
            if (now === before)
                continue;
            changed = true;
            if (now)
                this.#awake.set(id, now);
            else
                this.#awake.delete(id);
            const back = now !== null && this.#back.delete(id);
            this.#logHold(id, d, before, now, back);
        }
        // Removed services keep nothing.
        for (const id of [...this.#awake.keys()]) {
            if (!this.definition(id))
                this.#awake.delete(id);
        }
        if (changed)
            this.#emit();
    }

    #logHold(id, d, before, now, back) {
        if (now === null) {
            if (before === 'refused')
                return;
            const away = holdsWhile(this.stateOf(id)) && this.#away.has(id);
            this.#log(id, away ? Services.awayFor(d.keepAwake) : Services.noLongerKeepingAwake);
        } else if (now === 'holding') {
            this.#log(id, back ? Services.back : before === 'pausedOnBattery' ? Services.keepingAwakeResumed : Services.keepingAwake);
        } else if (now === 'pausedOnBattery') {
            if (before === null && !back)
                this.#log(id, Services.keepingAwake);
            this.#log(id, Services.keepingAwakePaused);
        } else {
            this.#log(id, Services.keepAwakeRefused);
        }
    }

    /**
     * The keep-awake limit, from the user's last activity (no polling): while the user is here,
     * a watch for idle as long as the limit; while away, a watch for the next input.
     */
    #watchActivity(id) {
        this.#activity.get(id)?.dispose();
        this.#activity.delete(id);
        const d = this.definition(id);
        const limit = d && holdsWhile(this.stateOf(id)) ? KEEP_AWAKE[d.keepAwake] : null;
        if (!limit) {
            if (this.#away.delete(id))
                this.#awakeChanged();
            return;
        }
        const idle = this.#ports.idle;
        if (this.#away.has(id)) {
            this.#activity.set(id, idle.onActive(() => {
                this.#away.delete(id);
                this.#syncHoldBack(id);
            }));
        } else if (idle.idleMs() >= limit * 60_000) {
            this.#away.add(id);
            this.#syncHold(id);
        } else {
            this.#activity.set(id, idle.onIdle(limit * 60_000, () => {
                this.#away.add(id);
                this.#syncHold(id);
            }));
        }
    }

    /** The user is back: the hold comes back, and its log says so once GNOME answers. */
    #syncHoldBack(id) {
        this.#back.add(id);
        this.#syncHold(id);
    }

    // Inside: settings and notifications.

    /** The `services` setting changed (this process, prefs or dconf). */
    #definitionsChanged() {
        const ids = new Set(this.definitions.map(d => d.id));
        for (const id of new Set([...this.#runtime.keys(), ...this.#logs.keys()])) {
            if (ids.has(id))
                continue;
            // Removed: a live one stops, and its state and log go once it has exited.
            if (isLive(this.stateOf(id)))
                this.#stopRun(id);
            else
                this.#forget(id);
        }
        for (const d of this.definitions) {
            // Restart switched off: a waiting restart doesn't run.
            if (!d.restartOnExit)
                this.#cancelRestart(d.id);
            this.#syncHold(d.id);
        }
        if (this.openLogs && !ids.has(this.openLogs))
            this.openLogs = null;
        this.#emit();
    }

    #forget(id) {
        this.#restartWaits.get(id)?.dispose();
        this.#restartWaits.delete(id);
        this.#streaks.delete(id);
        this.#automatic.delete(id);
        this.#runtime.delete(id);
        this.#activity.get(id)?.dispose();
        this.#activity.delete(id);
        this.#away.delete(id);
        this.#back.delete(id);
        this.#ports.keepAwake.set(holder(id), [], '');
        this.#awake.delete(id);
        this.#logs.delete(id);
        this.#silentPorts.delete(id);
    }

    /** Show Logs, or a click on a service's notification. Ignored while locked (G2). */
    #answered({id, action}) {
        if (!id.startsWith(NOTIFICATION_PREFIX) || this.#ports.session.locked)
            return;
        if (action === null || action === 'show-logs')
            this.showLogs(id.slice(NOTIFICATION_PREFIX.length));
    }

    #ring(id) {
        if (!this.#logs.has(id))
            this.#logs.set(id, new LogRing());
        return this.#logs.get(id);
    }

    #log(id, text) {
        this.#ring(id).appendLine(text, this.#now());
    }

    // Inside: the screen.

    #row(d, now) {
        const id = d.id;
        const s = this.stateOf(id);
        const silent = this.#silentPorts.has(id);
        let status = 'stopped';
        let meta = null;
        let metaStyle = 'secondary';
        let spoken = null;
        if (s.kind === 'starting') {
            status = 'starting';
            meta = Services.startingMeta(d.port);
        } else if (s.kind === 'running') {
            status = 'running';
            if (silent && s.port) {
                meta = Services.silentMeta(s.port);
                metaStyle = 'warn';
            } else {
                meta = Services.runningMeta(s.port, format.minutes((now - s.since) / 1000, 'up'));
                metaStyle = 'accent';
            }
        } else if (s.kind === 'waitingToRestart') {
            status = 'starting';
            const seconds = Math.max(1, Math.ceil((s.at - now) / 1000));
            meta = Services.restartingMeta(seconds, Services.exitPhrase(s.lastExit));
            metaStyle = 'warn';
            spoken = Services.restartingAccessible(seconds);
        } else if (s.kind === 'failed') {
            status = 'failed';
            meta = s.gaveUpSince !== null
                ? Services.gaveUpMeta(format.time(new Date(s.gaveUpSince), this.#ports.clock.timeFormat()), MAX_RESTARTS)
                : Services.failedMeta(s.exitCode, Services.ago(s.at, now));
        }
        // A service that breaks a rule can only have come from a hand-edited setting.
        const problem = isLive(s) ? null : firstProblem(d);
        if (problem) {
            meta = Services.cantStart(problem);
            metaStyle = 'warn';
        }
        const live = isLive(s) || s.kind === 'waitingToRestart';
        const away = this.#away.has(id);
        const awake = this.#awake.get(id) ?? null;
        const logsOpen = this.openLogs === id;
        // Only the open drawer gets lines, and only the last ones (Scan S3-1).
        const lines = logsOpen ? (this.#logs.get(id)?.tail(DRAWER_LINES) ?? []).map(line => ({id: line.id, time: logTime(line.time), text: line.text})) : [];
        const url = this.localUrl(id);
        return {
            id, name: displayName(d), status, meta, metaStyle,
            commandLine: Services.actionSubtitle(showControls(d.command), showControls(d.cwd)),
            keepsAwake: d.keepAwake !== 'off', restarts: d.restartOnExit, awake,
            keepAwakeHelp: Services.keepAwakeTooltip(awake, d.keepAwake, away), keepAwakeAway: away,
            logsOpen, logsWarning: silent && isLive(s),
            action: live ? {kind: 'run', title: 'Stop', glyph: 'stop', primary: false}
                : problem ? {kind: 'edit', title: Services.edit}
                    : {kind: 'run', title: 'Start', glyph: 'play', primary: true},
            accessibleName: Services.rowAccessible({name: displayName(d), status, keepsAwake: d.keepAwake !== 'off', awake, limit: d.keepAwake, away, restarts: d.restartOnExit}),
            accessibleValue: spoken,
            link: url ? {portLabel: Services.portLabel(s.port), help: Services.openLocalhost(s.port), accessibleAction: Services.openInBrowser, url} : null,
            log: logsOpen ? {lines, emptyText: lines.length ? null : Services.noOutput, clear: Services.clear} : null,
        };
    }

    #refresh() {
        this.state = Object.freeze({snapshot: this.snapshot, openLogs: this.openLogs, failureUnseen: this.failureUnseen});
    }

    #emit() {
        this.#refresh();
        if (!this.#scope.disposed)
            this.#writeRunning();
        this.emit('changed');
    }

    /**
     * `running-services`: the live services' ids, for prefs' copy (ADR-002 §8.1). Written only
     * here, and only when the list differs.
     */
    #writeRunning() {
        const ids = this.definitions.map(d => d.id).filter(id => holdsWhile(this.stateOf(id)));
        if (JSON.stringify(ids) !== JSON.stringify(this.#ports.store.state['running-services']))
            this.#ports.store.set('running-services', ids);
    }
}

/**
 * Saves a service in the `services` setting: adds it, or replaces the one with its id.
 * Returns the problems that kept it from being saved, by field; {} when saved. Prefs and the
 * HUD both save through this.
 * @param {import('./settings.js').SettingsStore} store
 * @param {{isFolder: (path: string) => Promise<boolean>}} files
 */
export async function saveService(store, files, d) {
    const found = problems(d);
    if (!found.cwd && !(await files.isFolder(d.cwd)))
        found.cwd = ListForm.folderMissing;
    if (Object.keys(found).length)
        return found;
    const saved = {...d, name: d.name.trim()};
    const list = (store.state.services ?? []).map(readDefinition);
    const index = list.findIndex(x => x.id === d.id);
    if (index >= 0)
        list[index] = saved;
    else
        list.push(saved);
    store.set('services', list.map(writeDefinition));
    return {};
}

/** Removes a service from the `services` setting: a live one stops (ServiceStore sees the change). */
export function deleteService(store, id) {
    store.set('services', (store.state.services ?? []).map(readDefinition).filter(d => d.id !== id).map(writeDefinition));
}
