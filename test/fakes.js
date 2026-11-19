// A fake for each port in lib/core/ports.js, for the tests and for building views before an
// adapter exists; not shipped. Each fake counts its live handles (`live`), so the lifecycle
// tests can assert that `disable()` left none.

class Handles {
    #live = new Set();

    add(onDispose = () => {}) {
        const handle = {
            dispose: () => {
                if (this.#live.delete(handle))
                    onDispose();
            },
        };
        this.#live.add(handle);
        return handle;
    }

    get size() {
        return this.#live.size;
    }
}

/** Calls each watcher; the watchers are the handles. */
class Watchers {
    #fns = new Map();
    #handles = new Handles();

    add(fn) {
        const handle = this.#handles.add(() => this.#fns.delete(handle));
        this.#fns.set(handle, fn);
        return handle;
    }

    call(...args) {
        for (const fn of [...this.#fns.values()])
            fn(...args);
    }

    get size() {
        return this.#handles.size;
    }
}

const copy = value => JSON.parse(JSON.stringify(value));

/** `Clock` and `Scheduler` on a manual clock: `advance(ms)` runs what comes due. */
export class FakeClock {
    #now;
    #timers = new Set();
    #handles = new Handles();

    constructor(now = new Date('2026-11-18T09:00:00Z')) {
        this.#now = now.getTime();
    }

    now() {
        return new Date(this.#now);
    }

    timeFormat() {
        return '24h';
    }

    at(date, fn) {
        return this.#add({due: date.getTime(), fn});
    }

    every(ms, fn) {
        return this.#add({due: this.#now + ms, fn, ms});
    }

    /** The clock moves without running the timers, as through a suspend. */
    jump(ms) {
        this.#now += ms;
    }

    advance(ms) {
        const end = this.#now + ms;
        for (;;) {
            const next = [...this.#timers].sort((a, b) => a.due - b.due)[0];
            if (!next || next.due > end)
                break;
            this.#now = Math.max(this.#now, next.due);
            if (next.ms)
                next.due += next.ms;
            else
                next.handle.dispose();
            next.fn();
        }
        this.#now = end;
    }

    get live() {
        return this.#handles.size;
    }

    #add(timer) {
        timer.handle = this.#handles.add(() => this.#timers.delete(timer));
        this.#timers.add(timer);
        return timer.handle;
    }
}

/** `GnomeKeys` over a list of bindings; `setSwitchInputSource` updates the list. */
export class FakeGnomeKeys {
    #watchers = new Watchers();
    sources;
    /** Every value written to switch-input-source. */
    writes = [];

    constructor({bindings, sources = 1} = {}) {
        this.list = copy(bindings ?? [
            {
                schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-input-source',
                name: 'Switch to next input source', accels: ['<Super>space', 'XF86Keyboard'],
            },
            {
                schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-input-source-backward',
                name: 'Switch to previous input source', accels: ['<Shift><Super>space', '<Shift>XF86Keyboard'],
            },
            {
                schema: 'org.gnome.shell.keybindings', key: 'toggle-message-tray',
                name: 'Show the notification list', accels: ['<Super>v', '<Super>m'],
            },
        ]);
        this.sources = sources;
    }

    bindings() {
        return copy(this.list);
    }

    inputSourceCount() {
        return this.sources;
    }

    setSwitchInputSource(accels) {
        this.writes.push(copy(accels));
        this.binding('switch-input-source').accels = copy(accels);
        this.#watchers.call();
    }

    /** The test changes GNOME's settings, as the user would in Settings → Keyboard. */
    userSets(key, accels) {
        this.binding(key).accels = copy(accels);
        this.#watchers.call();
    }

    userSetsSources(count) {
        this.sources = count;
        this.#watchers.call();
    }

    binding(key) {
        return this.list.find(b => b.key === key);
    }

    watch(fn) {
        return this.#watchers.add(fn);
    }

    get live() {
        return this.#watchers.size;
    }
}

/** `Hotkey`; `refuse` makes the next registrations fail; `press()` activates it. */
export class FakeHotkey {
    accels = null;
    refuse = false;
    /** How many times `register` was called. */
    registrations = 0;
    #onActivate = null;

    register(accels, onActivate) {
        this.registrations++;
        if (this.accels)
            throw new Error('already registered');
        if (this.refuse)
            return 'failed';
        this.accels = copy(accels);
        this.#onActivate = onActivate;
        return 'ok';
    }

    unregister() {
        this.accels = null;
        this.#onActivate = null;
    }

    press() {
        this.#onActivate?.();
    }

    get live() {
        return this.accels ? 1 : 0;
    }
}

/** `Session`; `lock()` and `unlock()` change it. */
export class FakeSession {
    locked = false;
    #watchers = new Watchers();

    watch(fn) {
        return this.#watchers.add(fn);
    }

    lock() {
        this.locked = true;
        this.#watchers.call(true);
    }

    unlock() {
        this.locked = false;
        this.#watchers.call(false);
    }

    get live() {
        return this.#watchers.size;
    }
}

/** `Hud`, with the shell adapter's lock gate: `show()` and `focus()` refuse while locked. */
export class FakeHud {
    visible = false;
    focusedSince = null;
    /** How many times it was shown or focused. */
    opened = 0;

    constructor(session, clock) {
        this.session = session;
        this.clock = clock;
    }

    show() {
        if (this.session.locked)
            return;
        this.visible = true;
        this.focusedSince = null;
        this.opened++;
    }

    /** Set to make the next grabs fail, as when another modal holds the keyboard. */
    refuseGrab = false;

    focus() {
        if (this.session.locked)
            return false;
        this.visible = true;
        this.opened++;
        if (this.refuseGrab) {
            this.focusedSince = null;
            return false;
        }
        this.focusedSince = this.clock.now();
        return true;
    }

    hide() {
        this.visible = false;
        this.focusedSince = null;
    }

    get live() {
        return 0;
    }
}

/** `Notifier`: `shown` maps id to what shows; `answer()` plays a button or a click. */
export class FakeNotifier {
    shown = new Map();
    /** Every post, in order. */
    posts = [];
    #watchers = new Watchers();

    post(n) {
        this.posts.push(n);
        this.shown.set(n.id, n);
    }

    withdraw(id) {
        this.shown.delete(id);
    }

    onAction(fn) {
        return this.#watchers.add(fn);
    }

    /** The user answers the notification `id` with `action` (null: a click on its body). */
    answer(id, action = null) {
        const n = this.shown.get(id) ?? this.posts.findLast(p => p.id === id);
        this.#watchers.call({id, category: n?.category ?? '', action});
    }

    get live() {
        return this.#watchers.size;
    }
}

/**
 * `Inhibitor`: grants every hold, or refuses the flags in `refuse`. `held` lists what is held
 * now ({flags, reason}); `answerLater` keeps answers until `answerAll()`.
 */
export class FakeInhibitor {
    held = [];
    refuse = new Set();
    answerLater = false;
    #waiting = [];

    hold(flags, reason) {
        return new Promise(resolve => {
            const answer = () => {
                if (this.refuse.has(flags)) {
                    resolve(null);
                    return;
                }
                const hold = {flags, reason};
                this.held.push(hold);
                resolve({dispose: () => (this.held = this.held.filter(h => h !== hold))});
            };
            if (this.answerLater)
                this.#waiting.push(answer);
            else
                answer();
        });
    }

    answerAll() {
        this.#waiting.splice(0).forEach(answer => answer());
    }

    get live() {
        return this.held.length;
    }
}

/** `Power`; `set(onBattery)` switches the source. */
export class FakePower {
    onBattery = false;
    #watchers = new Watchers();

    watch(fn) {
        return this.#watchers.add(fn);
    }

    set(onBattery) {
        this.onBattery = onBattery;
        this.#watchers.call();
    }

    get live() {
        return this.#watchers.size;
    }
}

/**
 * `Processes`: each start is a run the test drives: `write(text)` puts output in its pipe,
 * `exit({code} | {signal})` ends it. `stop()` asks for a SIGTERM: the run exits with signal 15
 * unless `ignoresStop`. `runs` keeps every run; `stoppedAll` counts the pattern stops.
 */
export class FakeProcesses {
    runs = [];
    /** Waits for a readable pipe still pending: none may outlive dispose. */
    waits = new Set();
    stoppedAll = 0;
    refuse = false;
    shell = {shell: '/bin/bash', fallback: null};
    #nextPid = 1000;

    start(spec) {
        if (this.refuse)
            throw new Error('spawn failed');
        const chunks = [];
        let ended = false;
        let wake = null;
        let resolveExit;
        const ready = () => {
            if (wake && (chunks.length || ended)) {
                const resolve = wake;
                wake = null;
                resolve();
            }
        };
        const fake = this;
        const run = {
            spec, pid: this.#nextPid, unit: `headsup-${spec.id}-${(this.#nextPid++).toString(16).padStart(8, '0')}.scope`,
            stops: 0, ignoresStop: false,
            exited: new Promise(resolve => (resolveExit = resolve)),
            output: {
                whenReadable: fn => {
                    const wait = {fn};
                    wake = () => {
                        fake.waits.delete(wait);
                        fn();
                    };
                    fake.waits.add(wait);
                    ready();
                    return {dispose: () => {
                        fake.waits.delete(wait);
                        if (wake && fake.waits.size === 0)
                            wake = null;
                    }};
                },
                read: max => {
                    if (!chunks.length)
                        return Promise.resolve(null);
                    const chunk = chunks.shift();
                    if (chunk.length > max) {
                        chunks.unshift(chunk.subarray(max));
                        return Promise.resolve(chunk.subarray(0, max));
                    }
                    return Promise.resolve(chunk);
                },
            },
            write(text) {
                chunks.push(new TextEncoder().encode(text));
                ready();
            },
            /** The process ends; `endOutput: false` keeps its pipe open (a child still writes). */
            exit(how, {endOutput = true} = {}) {
                if (endOutput)
                    run.endOutput();
                resolveExit(how);
            },
            endOutput() {
                ended = true;
                ready();
            },
            stop() {
                run.stops++;
                if (!run.ignoresStop)
                    run.exit({signal: 15});
            },
        };
        this.runs.push(run);
        return run;
    }

    /** The last run of service `id`. */
    last(id) {
        return this.runs.filter(r => r.spec.id === id).at(-1);
    }

    stopAll() {
        this.stoppedAll++;
        for (const run of this.runs)
            run.exit({signal: 15});
        return Promise.resolve(this.runs.length);
    }

    loginShell() {
        return this.shell;
    }

    get live() {
        return this.waits.size;
    }
}

/** `PortProbe`: `listeningPort` and `answering` are what the probe finds. */
export class FakePortProbe {
    listeningPort = null;
    answering = new Set();

    listening() {
        return Promise.resolve(this.listeningPort);
    }

    answers(port) {
        return Promise.resolve(this.answering.has(port));
    }

    get live() {
        return 0;
    }
}

/** `Idle` on the fake clock: `input()` is the user's input; idle watches fire as time passes. */
export class FakeIdle {
    #lastInput;
    #clock;
    #idle = new Set();
    #active = new Set();

    constructor(clock) {
        this.#clock = clock;
        this.#lastInput = clock.now().getTime();
    }

    idleMs() {
        return this.#clock.now().getTime() - this.#lastInput;
    }

    onIdle(ms, fn) {
        const watch = {ms, fn};
        this.#arm(watch);
        this.#idle.add(watch);
        return {dispose: () => {
            watch.timer.dispose();
            this.#idle.delete(watch);
        }};
    }

    onActive(fn) {
        const watch = {fn};
        this.#active.add(watch);
        return {dispose: () => this.#active.delete(watch)};
    }

    /** The user moves the mouse: active watches fire once; idle watches count from now. */
    input() {
        this.#lastInput = this.#clock.now().getTime();
        for (const watch of [...this.#active]) {
            this.#active.delete(watch);
            watch.fn();
        }
        for (const watch of this.#idle) {
            watch.timer.dispose();
            this.#arm(watch);
        }
    }

    #arm(watch) {
        watch.timer = this.#clock.at(new Date(this.#lastInput + watch.ms), () => {
            this.#idle.delete(watch);
            watch.fn();
        });
    }

    get live() {
        return this.#idle.size + this.#active.size;
    }
}

/** `Files`: the folders in `folders` exist ('~' among them). */
export class FakeFiles {
    folders = new Set(['~', '/tmp']);

    isFolder(path) {
        return Promise.resolve(this.folders.has(path));
    }

    get live() {
        return 0;
    }
}

/** `Links`: keeps what was opened. */
export class FakeLinks {
    opened = [];

    open(uri) {
        this.opened.push(uri);
    }

    get live() {
        return 0;
    }
}

/** `Preferences`: counts the times it was opened. */
export class FakePreferences {
    opened = 0;

    open() {
        this.opened++;
    }

    get live() {
        return 0;
    }
}

/** `Log`, keeping each entry: [code, fields]. */
export function fakeLog() {
    const log = (code, fields = {}) => log.entries.push([code, fields]);
    log.entries = [];
    return log;
}

/**
 * Every port of slice 0, faked, except `settings` and `state`: those come from the compiled
 * schema (the one source of keys and defaults), so the tests pass real GSettings ports on
 * the memory backend (test/harness.js `testPorts()`).
 */
export function fakePorts({settings, state, keys}) {
    const clock = new FakeClock();
    const session = new FakeSession();
    return {
        clock,
        scheduler: clock,
        settings,
        state,
        gnomeKeys: new FakeGnomeKeys(keys),
        hotkey: new FakeHotkey(),
        session,
        hud: new FakeHud(session, clock),
        notifier: new FakeNotifier(),
        preferences: new FakePreferences(),
        inhibitor: new FakeInhibitor(),
        power: new FakePower(),
        processes: new FakeProcesses(),
        portProbe: new FakePortProbe(),
        idle: new FakeIdle(clock),
        files: new FakeFiles(),
        links: new FakeLinks(),
        log: fakeLog(),
    };
}

/** Live handles across fakes, by port name; empty when none is left. */
export function liveHandles(ports) {
    const seen = new Set();
    const live = {};
    for (const [name, port] of Object.entries(ports)) {
        if (seen.has(port) || !(port.live > 0))
            continue;
        seen.add(port);
        live[name] = port.live;
    }
    return live;
}
