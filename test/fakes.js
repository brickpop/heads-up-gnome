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
