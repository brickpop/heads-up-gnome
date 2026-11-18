import GLib from 'gi://GLib';

import {test, assertEqual} from '../harness.js';
import {Scheduler, clock} from '../../lib/adapters/clock.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

const fakeResume = () => {
    const hook = {fn: null, live: 0};
    hook.watch = fn => {
        hook.fn = fn;
        hook.live++;
        return {dispose: () => hook.live--};
    };
    return hook;
};

test('at fires once at its date; a past date fires at once', async () => {
    const scheduler = new Scheduler(fakeResume().watch);
    const fired = [];
    scheduler.at(new Date(Date.now() + 30), () => fired.push('soon'));
    scheduler.at(new Date(Date.now() - 1000), () => fired.push('past'));
    await wait(80);
    assertEqual(fired, ['past', 'soon']);
    scheduler.dispose();
});

test('a disposed timer never fires; dispose ends everything', async () => {
    const resume = fakeResume();
    const scheduler = new Scheduler(resume.watch);
    let fired = 0;
    scheduler.at(new Date(Date.now() + 20), () => fired++).dispose();
    scheduler.at(new Date(Date.now() + 20), () => fired++);
    scheduler.every(10, () => fired++);
    scheduler.dispose();
    await wait(60);
    assertEqual([fired, resume.live], [0, 0]);
});

test('every repeats until disposed', async () => {
    const scheduler = new Scheduler(fakeResume().watch);
    let ticks = 0;
    const handle = scheduler.every(10, () => ticks++);
    await wait(55);
    handle.dispose();
    const seen = ticks;
    await wait(30);
    assertEqual([seen >= 3, ticks], [true, seen]);
    scheduler.dispose();
});

/** Wall and monotonic clocks that run together until the test moves the wall clock. */
const clocks = () => {
    const c = {offset: 0};
    c.wall = () => GLib.get_real_time() + c.offset;
    c.mono = () => GLib.get_monotonic_time();
    return c;
};

test('on resume, timers are armed again from their wall-clock date', async () => {
    const resume = fakeResume();
    const c = clocks();
    const scheduler = new Scheduler(resume.watch, c);
    let fired = 0;
    scheduler.at(new Date(c.wall() / 1000 + 60_000), () => fired++);
    // A minute passed while suspended: the monotonic timeout still waits; resume re-arms.
    c.offset = 61_000_000;
    resume.fn();
    await wait(20);
    assertEqual(fired, 1);
    scheduler.dispose();
});

test('the wall clock jumps 5 s ahead: a timer now due fires at the next tick', async () => {
    const c = clocks();
    const scheduler = new Scheduler(fakeResume().watch, c);
    let fired = 0;
    scheduler.at(new Date(c.wall() / 1000 + 4_000), () => fired++);
    scheduler.every(10, () => {});
    c.offset = 5_000_000;
    await wait(40);
    assertEqual(fired, 1);
    scheduler.dispose();
});

test('the wall clock jumps 5 s back: a timer waits for its wall-clock date', async () => {
    const c = clocks();
    const scheduler = new Scheduler(fakeResume().watch, c);
    let fired = 0;
    scheduler.at(new Date(c.wall() / 1000 + 50), () => fired++);
    scheduler.every(10, () => {});
    c.offset = -5_000_000;
    await wait(100);
    assertEqual(fired, 0, 'not early');
    scheduler.dispose();
});

test('clock: now and the time format', () => {
    assertEqual(clock(null).timeFormat(), '24h');
    assertEqual(Math.abs(clock(null).now() - Date.now()) < 1000, true);
});
