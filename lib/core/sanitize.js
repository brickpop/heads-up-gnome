// Text cleaning shared by every layer.

/**
 * Error details with secrets masked (the Mac's redactSecrets, ADR-001 §6.4, F7):
 * `Authorization`, `x-api-key` and `api-key` values, Bearer tokens, keys in a URL query
 * (`key=`, `api_key=`, `token=`, `access_token=`, `auth=`), `sk-…`-style and `AIza…` keys,
 * and any token HeadsUp knows, each become "••••".
 */
export function redactSecrets(text, known = []) {
    let result = String(text);
    for (const token of known) {
        if (token.length >= 4)
            result = result.split(token).join('••••');
    }
    return result
        .replace(/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',}]+/gi, '$1$2••••')
        .replace(/([?&](api[_-]?key|key|token|access_token|auth)=)[^&\s#]+/gi, '$1••••')
        .replace(/(?<![?&])((x-)?api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1••••')
        .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '••••')
        .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{4,}/gi, '$1••••')
        .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, '••••');
}

/**
 * A name the user set, safe to show anywhere (the Mac's sanitizeForDisplay): tabs and line
 * breaks become spaces; control characters, direction marks and overrides, their isolates and
 * zero-width characters go; past `max` characters it is cut with "…".
 */
export function sanitizeForDisplay(text, max) {
    const hidden = c => c <= 0x1F || (c >= 0x7F && c <= 0x9F) || (c >= 0x200B && c <= 0x200F) ||
        (c >= 0x202A && c <= 0x202E) || c === 0x2060 || (c >= 0x2066 && c <= 0x2069) || c === 0x061C || c === 0xFEFF;
    const clean = [...String(text)]
        .map(c => (c === '\t' || c === '\n' || c === '\r' ? ' ' : c))
        .filter(c => !hidden(c.codePointAt(0)));
    if (max <= 0 || clean.length <= max)
        return clean.join('');
    return `${clean.slice(0, max - 1).join('')}…`;
}

/** The most text one label shows: 64 KB of UTF-8 (ADR-002 §5). markup.js and cutTail share it. */
export const TEXT_LIMIT = 64 * 1024;

/**
 * Text from a process, safe to show (Scan S3P-1): ANSI escape sequences (CSI, OSC and the rest)
 * go, as do C0 controls but tab and line feed, C1 controls, and the bidi embeddings, overrides
 * and isolates (U+202A–202E, U+2066–2069) that could reorder what follows.
 */
export function stripControls(text) {
    const input = String(text);
    // Most text has nothing to strip: one regex test, no copy.
    if (!HIDDEN.test(input))
        return input;
    return (input.includes('\u001B') ? withoutEscapes(input) : input).replace(HIDDEN_ALL, '');
}

// The controls stripControls removes: C0 but tab and line feed, DEL and C1, bidi controls.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const HIDDEN_ALL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** `text` without its escape sequences (ESC and what belongs to it). */
function withoutEscapes(text) {
    let out = '';
    let from = 0;
    for (let i = text.indexOf('\u001B'); i >= 0; i = text.indexOf('\u001B', from)) {
        out += text.slice(from, i);
        from = escapeEnd(text, i) + 1;
    }
    return out + text.slice(from);
}

/** The index of the last character of the escape sequence that starts at `i` (ESC). */
function escapeEnd(text, i) {
    const next = text[i + 1];
    // A sequence never crosses a line: an unended one stops before the line feed, which stays.
    if (next === '[') {
        // CSI: parameters and intermediates, then one final byte in @–~.
        let j = i + 2;
        while (j < text.length && text[j] !== '\n' && !(text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7E))
            j++;
        return text[j] === '\n' ? j - 1 : Math.min(j, text.length - 1);
    }
    if (next === ']') {
        // OSC: up to BEL, or ESC \.
        let j = i + 2;
        while (j < text.length && text[j] !== '\n' && text.charCodeAt(j) !== 0x07 && !(text.charCodeAt(j) === 0x1B && text[j + 1] === '\\'))
            j++;
        if (text[j] === '\n')
            return j - 1;
        return text.charCodeAt(j) === 0x1B ? j + 1 : Math.min(j, text.length - 1);
    }
    // Any other escape: ESC and the one character after it.
    return next !== undefined ? i + 1 : i;
}

/**
 * The end of `text` within `limitBytes` of UTF-8, starting on a line boundary (never mid-line
 * or mid-character): a log shows its newest lines. `cut` says whether anything was dropped.
 * @returns {{text: string, cut: boolean}}
 */
export function cutTail(text, limitBytes = TEXT_LIMIT) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= limitBytes)
        return {text, cut: false};
    // The first line that starts within the last limitBytes.
    let start = bytes.length - limitBytes;
    while (start < bytes.length && bytes[start - 1] !== 0x0A)
        start++;
    return {text: new TextDecoder().decode(bytes.subarray(start)), cut: true};
}

/**
 * `text` with every control shown, not run and not hidden (Scan, F1): what a confirmation
 * card or a subtitle shows of a command or a folder, so it shows exactly what runs. ESC as
 * ⟨ESC⟩, any other control (C0, DEL, C1, bidi, zero width) as ⟨U+202E⟩.
 */
export function showControls(text) {
    return [...String(text)].map(c => {
        const code = c.codePointAt(0);
        if (code === 0x1B)
            return '⟨ESC⟩';
        const hidden = code <= 0x1F || (code >= 0x7F && code <= 0x9F) || (code >= 0x200B && code <= 0x200F) ||
            (code >= 0x202A && code <= 0x202E) || code === 0x2060 || (code >= 0x2066 && code <= 0x2069) ||
            code === 0x061C || code === 0xFEFF;
        return hidden ? `⟨U+${code.toString(16).toUpperCase().padStart(4, '0')}⟩` : c;
    }).join('');
}
