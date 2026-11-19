// LogRing (the Mac's LogRingTests) and the read budget (Scan N2).

import GLib from 'gi://GLib';

import {test, assertEqual, settle} from '../harness.js';
import {LINE_COST, LOG_CAPACITY, LogRing, MAX_LINE, OutputReader, READ_BUDGET, TICK_BUDGET} from '../../lib/core/logRing.js';

const t = 1_800_000_000_000;
const bytes = text => new TextEncoder().encode(text);
const texts = ring => ring.lines.map(l => l.text);

test('output is stored line by line, even when chunks cut a line', () => {
    const ring = new LogRing();
    ring.appendOutput(bytes('Listening on '), t);
    assertEqual(texts(ring), []);
    ring.appendOutput(bytes(':3000\nready\r\nhalf'), t);
    assertEqual(texts(ring), ['Listening on :3000', 'ready']);
    ring.flush(t);
    assertEqual(texts(ring), ['Listening on :3000', 'ready', 'half']);
});

test('a character cut between chunks stays whole', () => {
    const ring = new LogRing();
    const all = bytes('café\n');
    ring.appendOutput(all.slice(0, 4), t);
    ring.appendOutput(all.slice(4), t);
    assertEqual(texts(ring), ['café']);
});

test('a character cut over three reads stays whole; one cut at the very end shows at flush', () => {
    const ring = new LogRing();
    const all = bytes('€ ok 😀\n');
    for (const b of all)
        ring.appendOutput(new Uint8Array([b]), t);
    assertEqual(texts(ring), ['€ ok 😀']);
    ring.appendOutput(bytes('é').slice(0, 1), t);
    ring.flush(t);
    assertEqual(texts(ring).at(-1), '\uFFFD');
});

test('it keeps only the newest lines within its capacity, each line costing its text plus 64', () => {
    const ring = new LogRing(2 * (6 + LINE_COST));
    for (let i = 0; i < 10; i++)
        ring.appendLine(`line ${i}`, t);
    assertEqual(texts(ring), ['line 8', 'line 9']);
    const big = new LogRing();
    for (let i = 0; i < 40_000; i++)
        big.appendLine(`output line number ${i}`, t);
    const held = big.lines.reduce((sum, l) => sum + bytes(l.text).length + LINE_COST, 0);
    assertEqual([held <= LOG_CAPACITY, big.lines.at(-1).text, big.size === held], [true, 'output line number 39999', true]);
    assertEqual(big.tail(3).map(l => l.text), ['output line number 39997', 'output line number 39998', 'output line number 39999']);
});

test('ids keep rising while old lines drop off; clear empties it', () => {
    const ring = new LogRing(2 * (6 + LINE_COST));
    for (let i = 0; i < 10; i++)
        ring.appendLine(`line ${i}`, t);
    assertEqual(ring.lines.map(l => l.id), [8, 9]);
    ring.clear();
    ring.appendLine('again', t);
    assertEqual([texts(ring), ring.lines[0].id], [['again'], 10]);
});

test('a pending line is cut at 16 KB with "…" (N2)', () => {
    const ring = new LogRing();
    ring.appendOutput(new Uint8Array(MAX_LINE * 2 + 10).fill(0x61), t);
    ring.appendOutput(bytes('\n'), t);
    assertEqual(ring.lines.map(l => l.text.length), [MAX_LINE + 1, MAX_LINE + 1, 10]);
    assertEqual(ring.lines[0].text.endsWith('…'), true);
});

/** A pipe that holds `total` bytes of lines shaped by `line`, readable while it has any. */
function floodPipe(total, line = bytes(`${'x'.repeat(79)}\n`)) {
    const block = new Uint8Array(READ_BUDGET);
    for (let at = 0; at < block.length; at += line.length)
        block.set(line.subarray(0, Math.min(line.length, block.length - at)), at);
    let left = total;
    const pipe = {asked: 0, whenReadable: fn => {
        let live = true;
        Promise.resolve().then(() => live && fn());
        return {dispose: () => (live = false)};
    }, read: max => {
        pipe.asked++;
        const n = Math.min(max, left, block.length);
        left -= n;
        return Promise.resolve(n ? block.subarray(0, n) : null);
    }};
    return pipe;
}

const turn = async () => {
    for (let i = 0; i < 6; i++)
        await Promise.resolve();
};

test('N2: 100 MB in from one service: at most 64 KB a tick, and the ring stays within 256 KB', async () => {
    const total = 100 * 1024 * 1024;
    const ring = new LogRing();
    const reader = new OutputReader();
    let read = 0;
    reader.add(floodPipe(total), chunk => {
        read += chunk.length;
        ring.appendOutput(chunk, t);
    });
    let ticks = 0;
    let most = 0;
    await turn();
    while (read < total && ticks < 5000) {
        reader.tick();
        await turn();
        most = Math.max(most, reader.readSinceTick);
        ticks++;
    }
    assertEqual([read, most <= READ_BUDGET, ring.size <= LOG_CAPACITY], [total, true, true]);
});

test('Scan S3-1: five services flood at once: at most 128 KB a tick in all, shared in turn; rings hold at most 5,000 lines', async () => {
    const shapes = [bytes('\n'), bytes('a\n'), bytes(`${'x'.repeat(79)}\n`), bytes('no newline at all '), bytes('😀😀😀\n')];
    const reader = new OutputReader();
    const rings = shapes.map(() => new LogRing());
    const got = shapes.map(() => 0);
    shapes.forEach((shape, i) => reader.add(floodPipe(64 * 1024 * 1024, shape), chunk => {
        got[i] += chunk.length;
        rings[i].appendOutput(chunk, t);
    }));
    await turn();
    const times = [];
    let most = 0;
    for (let tick = 0; tick < 300; tick++) {
        const start = GLib.get_monotonic_time();
        reader.tick();
        await turn();
        // The open drawer of one service, as the view reads it each tick.
        rings[tick % 5].tail(500);
        times.push(GLib.get_monotonic_time() - start);
        most = Math.max(most, reader.readSinceTick);
    }
    times.sort((a, b) => a - b);
    // Timing is printed, not asserted (Sally): the 5 ms budget is the CEO's check on real hardware.
    print(`     whole tick, 5 services: median ${times[150]} µs, p99 ${times[297]} µs, max ${times[299]} µs`);
    assertEqual(most <= TICK_BUDGET, true, `${most} bytes in one tick`);
    assertEqual(got.every(n => n > 0), true, 'every service got its turn');
    assertEqual(rings.map(r => r.count <= 5000 && r.size <= LOG_CAPACITY), [true, true, true, true, true], rings.map(r => r.count).join());
});

test('the reader stops at the end of the output; after stop() it reads nothing more', async () => {
    const pipe = floodPipe(10);
    const reader = new OutputReader();
    let got = 0;
    const source = reader.add(pipe, chunk => (got += chunk.length));
    await turn();
    reader.tick();
    await turn();
    reader.tick();
    await source.done;
    assertEqual([got, reader.size], [10, 0]);
    const second = floodPipe(1024 * 1024);
    const stopped = reader.add(second, () => {});
    stopped.stop();
    reader.tick();
    await settle();
    assertEqual(second.asked, 0);
});

// Scan, slice 3 audit (N2): a flood of empty lines must stay as cheap as one of long lines.
// Fails today: capacity counts text bytes only, so 256 KB holds 262,144 empty lines, and
// reading them for a services row costs 80–180 ms on the shell's main loop.
test('N2: a flood of empty lines keeps the ring small', () => {
    const ring = new LogRing();
    const flood = new Uint8Array(READ_BUDGET).fill(0x0A);
    for (let tick = 0; tick < 8; tick++)
        ring.appendOutput(flood, t + tick * 100);
    const lines = ring.lines.length;
    assertEqual(lines <= 5000, true, `${lines} lines held`);
});

// Scan, slice 3 re-audit (Critical): drain() while a tick's read is still in flight must
// leave the main loop running. Today it spins on `await Promise.resolve()`, so the read's
// callback never arrives and this test never finishes: neither would gnome-shell.
test('drain while a read is in flight lets the main loop run', async () => {
    const later = (ms, value) => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve(value);
        return GLib.SOURCE_REMOVE;
    }));
    let reads = 0;
    const pipe = {
        whenReadable: fn => {
            let live = true;
            later(0).then(() => live && fn());
            return {dispose: () => (live = false)};
        },
        read: () => later(5, ++reads <= 3 ? new Uint8Array(10).fill(0x61) : null),
    };
    const reader = new OutputReader();
    let got = 0;
    const source = reader.add(pipe, chunk => (got += chunk.length));
    await later(1);
    reader.tick();
    source.drain();
    let turns = 0;
    await later(1).then(() => turns++);
    await Promise.race([source.done, later(200)]);
    assertEqual([turns, got >= 10], [1, true]);
});
