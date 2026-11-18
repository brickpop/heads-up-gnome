// The only caller of `console` (G3, ADR-002 §5). It takes a fixed error code and fixed
// fields: numbers, booleans and short strings such as an id or a status, never text from
// the model, a tool, the clipboard, a service or a URL query. Strings are still redacted
// and cut, in case one slips through. The lines go to the journal under gnome-shell.

import {redactSecrets} from '../core/sanitize.js';

const CODE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const MAX_FIELD = 120;

const field = value => {
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return JSON.stringify(redactSecrets(String(value)).slice(0, MAX_FIELD));
};

/** The journal line: "HeadsUp: <code> key=value …". */
export function formatLine(code, fields = {}) {
    const name = CODE.test(code) ? code : 'log.bad-code';
    const parts = Object.entries(fields)
        .filter(([key]) => CODE.test(key))
        .map(([key, value]) => `${key}=${field(value)}`);
    return ['HeadsUp:', name, ...parts].join(' ');
}

/** @type {import('../core/ports.js').Log} */
export function log(code, fields = {}) {
    console.warn(formatLine(code, fields));
}
