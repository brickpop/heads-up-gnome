// A service the user defined (the Mac's ServiceDefinition; ADR-002 §6.4, §8.1): a long-running
// command HeadsUp starts and stops, in a folder, with extra environment variables. Stored in
// the `services` setting (aa{sv}); every entry is checked on read with the Mac's rules, and one
// that breaks a rule is listed with "Can't start · <reason>".

import {sanitizeForDisplay, stripControls} from './sanitize.js';
import {ListForm, Services} from './strings.js';

/** How long a service keeps the computer awake, from the user's last activity; minutes or null. */
export const KEEP_AWAKE = Object.freeze({'off': null, '30m': 30, '2h': 120, '5h': 300, 'unlimited': null});
/** The keep-awake choices, in the order the form shows them. */
export const KEEP_AWAKE_CHOICES = Object.freeze(['off', '30m', '2h', '5h', 'unlimited']);
/** The fields, in the form's order, for its problems. */
export const FIELDS = Object.freeze(['name', 'command', 'cwd', 'env', 'port']);

/** A service id goes into a systemd unit name: only a UUID may (G10). */
export const validServiceId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
/** `[A-Za-z_][A-Za-z0-9_]*` (G10). */
export const validEnvKey = key => typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);

const str = value => (typeof value === 'string' ? value : '');

/**
 * One entry of the `services` setting as a definition, lenient as the Mac's decoder: a field
 * left out takes its default. A keep-awake value this build doesn't know reads as off, so a
 * bad value never holds longer than asked.
 */
export function readDefinition(entry) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const env = e.env && typeof e.env === 'object' && !Array.isArray(e.env) ? e.env : {};
    return Object.freeze({
        id: str(e.id),
        name: str(e.name),
        command: str(e.command),
        cwd: str(e.cwd) || '~',
        env: Object.freeze(Object.entries(env).map(([key, value]) => Object.freeze({key, value: str(value)}))),
        port: Number.isInteger(e.port) && e.port > 0 ? e.port : null,
        autostart: e.autostart === true,
        keepAwake: KEEP_AWAKE_CHOICES.includes(e['keep-awake-for']) ? e['keep-awake-for'] : 'off',
        restartOnExit: e['restart-on-exit'] === true,
    });
}

/** A definition as an entry of the `services` setting. */
export function writeDefinition(d) {
    return {
        'id': d.id, 'name': d.name, 'command': d.command, 'cwd': d.cwd,
        'env': Object.fromEntries(d.env.map(({key, value}) => [key, value])),
        'port': d.port ?? 0, 'autostart': d.autostart, 'keep-awake-for': d.keepAwake, 'restart-on-exit': d.restartOnExit,
    };
}

/**
 * The problems that keep a definition from being saved or started, by field; empty when valid.
 * A NUL can't be passed to a process (F13); the id must be a UUID (G10).
 */
export function problems(d) {
    const found = {};
    const name = d.name.trim();
    if (!name)
        found.name = ListForm.nameEmpty;
    else if ([...name].length > 64)
        found.name = ListForm.nameTooLong;
    if (!d.command.trim())
        found.command = ListForm.commandProblem;
    else if (d.command.includes('\0'))
        found.command = ListForm.nulProblem;
    if (d.cwd.includes('\0'))
        found.cwd = ListForm.nulProblem;
    if (d.port !== null && !(Number.isInteger(d.port) && d.port >= 1 && d.port <= 65535))
        found.port = Services.portProblem;
    if (d.env.some(v => !validEnvKey(v.key)))
        found.env = Services.envKeyProblem;
    else if (d.env.some(v => v.value.includes('\0')))
        found.env = ListForm.nulProblem;
    if (!validServiceId(d.id))
        found.id = Services.idProblem;
    return found;
}

/** The first problem, in the form's order (the id last), for the row of a service that can't start. */
export function firstProblem(d) {
    const found = problems(d);
    return [...FIELDS, 'id'].map(field => found[field]).find(Boolean) ?? null;
}

/**
 * The form's fields as typed (the Mac's ServiceDraft): the port is text until Save.
 * @returns {{name, command, cwd, env: {key, value}[], port: string, autostart, keepAwake, restartOnExit}}
 */
export function draftOf(d) {
    return {
        name: d?.name ?? '', command: d?.command ?? '', cwd: d?.cwd ?? '~', env: d ? d.env.map(v => ({...v})) : [],
        port: d?.port ? String(d.port) : '', autostart: d?.autostart ?? false,
        keepAwake: d?.keepAwake ?? 'off', restartOnExit: d?.restartOnExit ?? false,
    };
}

/** A draft as a definition with `id`, or {portProblem: true} when the port isn't whole digits. */
export function definitionOf(draft, id) {
    const typed = String(draft.port ?? '').trim();
    if (typed && !/^[0-9]+$/.test(typed))
        return {portProblem: true};
    return {
        definition: Object.freeze({
            id, name: str(draft.name), command: str(draft.command), cwd: str(draft.cwd),
            env: Object.freeze(draft.env.map(({key, value}) => Object.freeze({key: str(key), value: str(value)}))),
            port: typed ? Number(typed) : null, autostart: draft.autostart === true,
            keepAwake: KEEP_AWAKE_CHOICES.includes(draft.keepAwake) ? draft.keepAwake : 'off',
            restartOnExit: draft.restartOnExit === true,
        }),
    };
}

/** Whether the form's draft differs from what is saved (null: a new service, from an empty form). */
export function draftChanged(draft, definition) {
    const saved = draftOf(definition);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return !same({...draft, env: draft.env.map(({key, value}) => ({key, value}))}, saved);
}

/**
 * A service's name as shown anywhere (rows, toasts, actions, notifications): no escape
 * sequences or controls (Scan S3P-1), at most 64 characters.
 */
export const displayName = d => sanitizeForDisplay(stripControls(d.name), 64);
