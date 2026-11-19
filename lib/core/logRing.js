// A service's log (the Mac's LogRing; ADR-002 §6.4): stdout and stderr merged, kept to the
// last 256 KB, in memory only. Output arrives in chunks that may cut a line, or a character,
// in two: a streaming decoder keeps the character whole, and a line is stored once it ends.
// A line still pending past 16 KB is cut there (N2).

import {stripControls} from './sanitize.js';

/** Bytes of text a log holds. */
export const LOG_CAPACITY = 256 * 1024;
/** The longest pending line kept whole (N2). */
export const MAX_LINE = 16 * 1024;
/**
 * What each line costs besides its text, in the capacity: a flood of empty lines then holds
 * at most 256 KB / 64 = 4,096 lines, not 262,144 (Scan S3-1).
 */
export const LINE_COST = 64;
/** The most lines a drawer shows: the last ones. */
export const DRAWER_LINES = 500;


export class LogRing {
    /** Lines held, from #head on: dropping from the front only moves #head (a flood stays cheap). */
    #lines = [];
    #head = 0;
    #size = 0;
    /** The start of a line that hasn't ended yet, decoded. */
    #pending = '';
    #nextId = 0;
    #capacity;
    #decoder = new TextDecoder('utf-8');
    /** The bytes of a character cut at the end of the last read (GJS's decoder can't stream). */
    #carry = new Uint8Array(0);

    constructor(capacity = LOG_CAPACITY) {
        this.#capacity = capacity;
    }

    /** Lines, oldest first: {id, time (ms), text}. */
    get lines() {
        return this.#lines.slice(this.#head).map(({id, time, text}) => ({id, time, text}));
    }

    /** The last `n` lines, without copying the rest: what the open drawer shows. */
    tail(n) {
        return this.#lines.slice(Math.max(this.#head, this.#lines.length - n)).map(({id, time, text}) => ({id, time, text}));
    }

    /** Lines held. */
    get count() {
        return this.#lines.length - this.#head;
    }

    /** Capacity used, in bytes (text plus LINE_COST per line), for the tests. */
    get size() {
        return this.#size;
    }

    /** Adds raw output from the process (a Uint8Array); a line is stored once it ends. */
    appendOutput(bytes, time) {
        const text = this.#decode(bytes);
        const last = text.lastIndexOf('\n');
        if (last < 0) {
            this.#pending += text;
        } else {
            // Escape sequences and controls never reach the drawer or Copy All (Scan S3P-1):
            // stripped once for all the lines that ended, never mid-line.
            const ended = stripControls(this.#pending + text.slice(0, last)).split('\n');
            this.#pending = text.slice(last + 1);
            for (const line of ended)
                this.#addCut(line, time);
        }
        // A line still pending past MAX_LINE is stored cut, with "…" (N2).
        while (this.#pending.length > MAX_LINE / 4 && utf8Length(this.#pending) > MAX_LINE) {
            const at = cutAt(this.#pending, MAX_LINE);
            this.#add(`${stripControls(this.#pending.slice(0, at))}…`, time);
            this.#pending = this.#pending.slice(at);
        }
    }

    /** Adds a line of HeadsUp's own: `$ npm run dev`, `starting…`, `process exited (code 1)`. */
    appendLine(text, time) {
        this.flush(time);
        this.#add(text, time);
    }

    /** Stores an unfinished last line, when the process has exited. */
    flush(time) {
        const rest = stripControls(this.#pending + this.#decoder.decode(this.#carry));
        this.#pending = '';
        this.#carry = new Uint8Array(0);
        if (rest)
            this.#addCut(rest, time);
    }

    /** Clear, from the log drawer. */
    clear() {
        this.#lines = [];
        this.#head = 0;
        this.#size = 0;
        this.#pending = '';
        this.#carry = new Uint8Array(0);
    }

    /**
     * Decodes `bytes` after the carried ones, keeping a character cut at the end for the next
     * read: what a streaming decoder does.
     */
    #decode(bytes) {
        let all = bytes;
        if (this.#carry.length) {
            all = new Uint8Array(this.#carry.length + bytes.length);
            all.set(this.#carry);
            all.set(bytes, this.#carry.length);
        }
        const whole = completeLength(all);
        this.#carry = all.slice(whole);
        return this.#decoder.decode(all.subarray(0, whole));
    }

    /** Adds a line, cut in MAX_LINE pieces with "…" when longer. */
    #addCut(line, time) {
        let rest = line;
        while (rest.length > MAX_LINE / 4 && utf8Length(rest) > MAX_LINE) {
            const at = cutAt(rest, MAX_LINE);
            this.#add(`${rest.slice(0, at)}…`, time);
            rest = rest.slice(at);
        }
        this.#add(rest, time);
    }

    #add(text, time) {
        const line = text.endsWith('\r') ? text.slice(0, -1) : text;
        this.#lines.push({id: this.#nextId++, time, text: line, bytes: utf8Length(line) + LINE_COST});
        this.#size += this.#lines.at(-1).bytes;
        while (this.#size > this.#capacity && this.#head < this.#lines.length)
            this.#size -= this.#lines[this.#head++].bytes;
        if (this.#head > 1024 && this.#head * 2 > this.#lines.length) {
            this.#lines = this.#lines.slice(this.#head);
            this.#head = 0;
        }
    }
}

/** How many bytes of `bytes` end on a character boundary: an incomplete last character waits. */
function completeLength(bytes) {
    // The last character starts at most 3 bytes before the end.
    for (let back = 1; back <= Math.min(3, bytes.length); back++) {
        const b = bytes[bytes.length - back];
        if ((b & 0xC0) === 0x80)
            continue;
        const size = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1;
        return size > back ? bytes.length - back : bytes.length;
    }
    return bytes.length;
}

/** The index in `text` where its first `maxBytes` UTF-8 bytes end, on a character boundary. */
function cutAt(text, maxBytes) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        const size = c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xD800 && c <= 0xDBFF ? 4 : 3;
        if (bytes + size > maxBytes)
            return i;
        bytes += size;
        if (size === 4)
            i++;
    }
    return text.length;
}

/** The UTF-8 length of `text`, without encoding it. */
function utf8Length(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x80) {
            n += 1;
        } else if (c < 0x800) {
            n += 2;
        } else if (c >= 0xD800 && c <= 0xDBFF) {
            n += 4;
            i++;
        } else {
            n += 3;
        }
    }
    return n;
}

/** "14:03:27", local time. */
export function logTime(ms) {
    const d = new Date(ms);
    const two = n => (n < 10 ? `0${n}` : `${n}`);
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** "14:03:27  Listening on :3000" */
export const formatLogLine = line => `${logTime(line.time)}  ${line.text}`;

/** Bytes read per service per tick, at most (N2). */
export const READ_BUDGET = 64 * 1024;
/** Bytes read per tick across all services, at most, shared in turn (Scan S3-1). */
export const TICK_BUDGET = 128 * 1024;
/** The tick of the read budget, and the most often the views hear of new output (ms). */
export const OUTPUT_TICK_MS = 100;

/**
 * Reads every service's output under the read budget (N2, Scan S3-1). On each tick, the
 * services whose pipe is readable read in turn, each at most READ_BUDGET, all together at
 * most TICK_BUDGET; the turn moves on at each tick. Between ticks nothing is read, so a flood
 * fills its pipe and the service waits on its writes instead of the desktop stuttering. A read
 * is issued only once the pipe is readable, so it returns at once and never holds the budget.
 */
export class OutputReader {
    #sources = [];
    #turn = 0;
    /** Bytes read since the last tick, for the tests. */
    readSinceTick = 0;

    /**
     * Reads `output` from the next tick on.
     * @param {{whenReadable: (fn: () => void) => {dispose(): void}, read: (max: number) => Promise<Uint8Array | null>}} output
     * @param {(bytes: Uint8Array) => void} onBytes
     * @returns {{done: Promise<void>, stop: () => void}} `done` resolves at the end of the output
     */
    add(output, onBytes) {
        const source = {output, onBytes, readable: false, reading: false, ended: false};
        source.done = new Promise(resolve => (source.end = resolve));
        source.stop = () => this.#end(source);
        source.drain = () => this.#drain(source);
        this.#sources.push(source);
        this.#arm(source);
        return {done: source.done, stop: source.stop, drain: source.drain};
    }

    /** Outputs still read. */
    get size() {
        return this.#sources.length;
    }

    /** A new tick: the readable outputs read, in turn, within the budgets. */
    tick() {
        this.readSinceTick = 0;
        const count = this.#sources.length;
        let left = TICK_BUDGET;
        const ready = [];
        for (let i = 0; i < count && left > 0; i++) {
            const source = this.#sources[(this.#turn + i) % count];
            if (!source.readable || source.reading || source.ended)
                continue;
            const size = Math.min(READ_BUDGET, left);
            left -= size;
            ready.push([source, size]);
        }
        this.#turn = count ? (this.#turn + 1) % count : 0;
        for (const [source, size] of ready)
            this.#read(source, size);
    }

    /**
     * The process exited: what its pipe still holds is read at once, at most READ_BUDGET
     * (a pipe holds 64 KB); anything more waits for the ticks, as before. It never waits on
     * anything but a real read (Scan S3-5): a read in flight is awaited through its own
     * promise, so the main loop keeps running.
     */
    async #drain(source) {
        let read = 0;
        while (!source.ended && read < READ_BUDGET) {
            if (source.reading) {
                await source.inflight;
                continue;
            }
            if (!source.readable)
                return;
            const bytes = await this.#read(source, READ_BUDGET - read);
            if (!bytes)
                return;
            read += bytes;
        }
    }

    /** One read; resolves with the bytes read, or 0 at the end. Kept as `source.inflight`. */
    #read(source, size) {
        source.reading = true;
        source.readable = false;
        source.inflight = source.output.read(size).catch(() => null).then(bytes => this.#arrived(source, bytes));
        return source.inflight;
    }

    #arrived(source, bytes) {
        source.reading = false;
        source.inflight = null;
        if (source.ended)
            return 0;
        if (!bytes || !bytes.length) {
            this.#end(source);
            return 0;
        }
        this.readSinceTick += bytes.length;
        source.onBytes(bytes);
        this.#arm(source);
        return bytes.length;
    }

    #arm(source) {
        source.wait = source.output.whenReadable(() => {
            source.wait = null;
            if (!source.ended)
                source.readable = true;
        });
    }

    #end(source) {
        if (source.ended)
            return;
        source.ended = true;
        // No wait outlives the reading: disable() leaves no pollable source behind.
        source.wait?.dispose();
        source.wait = null;
        this.#sources = this.#sources.filter(s => s !== source);
        source.end();
    }
}
