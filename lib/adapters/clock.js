// The `Clock` and `Scheduler` ports (ADR-002 §6.2). End dates are wall-clock, but GLib
// timeouts count monotonic time, which stops during suspend: so every timer is armed again
// on resume and when the wall clock jumps (by over 2 s against monotonic time).

import GLib from 'gi://GLib';

import {Scope} from '../core/scope.js';

const JUMP_US = 2_000_000;

/**
 * @param {Gio.Settings | null} interfaceSettings  `org.gnome.desktop.interface`, for clock-format
 * @returns {import('../core/ports.js').Clock}
 */
export function clock(interfaceSettings) {
    return {
        now: () => new Date(),
        timeFormat: () => (interfaceSettings?.get_string('clock-format') === '12h' ? '12h' : '24h'),
    };
}

/**
 * @implements {import('../core/ports.js').Scheduler}
 */
export class Scheduler {
    #timers = new Set();
    #scope = new Scope();
    #wallNow;
    #monoNow;
    #wall;
    #mono;

    /**
     * @param {(fn: () => void) => import('../core/ports.js').Handle} watchResume  login1's
     * @param {object} [clocks]  the wall and monotonic clocks in microseconds; tests pass their own
     */
    constructor(watchResume, {wall = () => GLib.get_real_time(), mono = () => GLib.get_monotonic_time()} = {}) {
        this.#wallNow = wall;
        this.#monoNow = mono;
        this.#wall = wall();
        this.#mono = mono();
        this.#scope.add(watchResume(() => this.#rearm()));
    }

    at(date, fn) {
        const timer = {date, fn, source: 0};
        timer.handle = this.#scope.add(() => {
            this.#timers.delete(timer);
            this.#disarm(timer);
        });
        this.#timers.add(timer);
        this.#arm(timer);
        return timer.handle;
    }

    every(ms, fn) {
        const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this.#checkJump();
            fn();
            return GLib.SOURCE_CONTINUE;
        });
        return this.#scope.add(() => GLib.source_remove(source));
    }

    /** Arms every timer again from its wall-clock date. */
    #rearm() {
        this.#wall = this.#wallNow();
        this.#mono = this.#monoNow();
        for (const timer of this.#timers) {
            this.#disarm(timer);
            this.#arm(timer);
        }
    }

    dispose() {
        this.#scope.dispose();
    }

    #arm(timer) {
        const delay = Math.max(0, timer.date.getTime() - this.#wallNow() / 1000);
        timer.source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            timer.source = 0;
            timer.handle.dispose();
            timer.fn();
            return GLib.SOURCE_REMOVE;
        });
    }

    #disarm(timer) {
        if (timer.source)
            GLib.source_remove(timer.source);
        timer.source = 0;
    }

    #checkJump() {
        const wall = this.#wallNow() - this.#wall;
        const mono = this.#monoNow() - this.#mono;
        if (Math.abs(wall - mono) > JUMP_US)
            this.#rearm();
        else {
            this.#wall += wall;
            this.#mono += mono;
        }
    }
}
