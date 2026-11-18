// Settings → Focus (the Mac's FocusSettings; ADR-002 §8.1). The rules hold for any value in
// dconf, whoever wrote it: a value outside its allowed set reads as the default, invalid or
// repeated break options are dropped, and an empty list reads as the defaults.

export const FOCUS_LENGTHS = Object.freeze([25, 40, 50]);
/** Break and option lengths, in minutes, in the order a click cycles them. */
export const BREAK_LENGTHS = Object.freeze([2, 5, 10, 20, 50]);
export const SNOOZE_LENGTHS = Object.freeze([2, 5, 10]);
/** Any length typed (`/start 35`, `/break 7`) or asked for by the focus.timer tool. */
export const ANY_FOCUS_RANGE = Object.freeze([1, 180]);
export const ANY_BREAK_RANGE = Object.freeze([1, 60]);
/** The length a new option starts with. */
export const NEW_OPTION_LENGTH = 5;
export const BREAK_ICONS = Object.freeze(['eye', 'droplet', 'activity', 'people', 'utensils', 'dot']);

/** The Focus spec's defaults; the schema's default for `break-options` is the same list. */
export const DEFAULT_BREAK_OPTIONS = Object.freeze([
    {id: 'look', label: 'Look elsewhere', icon: 'eye', minutes: 2},
    {id: 'water', label: 'Drink water', icon: 'droplet', minutes: 5},
    {id: 'stretch', label: 'Stretch your arms', icon: 'activity', minutes: 5},
    {id: 'friends', label: 'Ping a friend', icon: 'people', minutes: 10},
    {id: 'lunch', label: 'Have lunch', icon: 'utensils', minutes: 50},
].map(Object.freeze));

/** The activity selected at first: Drink water, or the first option. */
export const INITIAL_OPTION_ID = 'water';

const FIXED_IDS = new Set(DEFAULT_BREAK_OPTIONS.map(o => o.id));
const CUSTOM_ID = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for a break option id: one of the defaults', or "custom-<uuid>". */
export const validOptionId = id => typeof id === 'string' && (FIXED_IDS.has(id) || CUSTOM_ID.test(id));

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** One option as stored, or null when it can't be one. */
function readOption(entry) {
    if (!entry || typeof entry !== 'object' || !validOptionId(entry.id))
        return null;
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label)
        return null;
    return Object.freeze({
        id: entry.id,
        label,
        icon: oneOf(entry.icon, BREAK_ICONS, 'dot'),
        minutes: oneOf(entry.minutes, BREAK_LENGTHS, 5),
    });
}

/**
 * Settings → Focus from the settings state, by the rules.
 * @param {object} state  SettingsStore.state
 */
export function readFocusSettings(state) {
    const seen = new Set();
    const options = (Array.isArray(state['break-options']) ? state['break-options'] : [])
        .map(readOption)
        .filter(option => option && !seen.has(option.id) && seen.add(option.id));
    return Object.freeze({
        focusLength: oneOf(state['focus-length'], FOCUS_LENGTHS, 25),
        snoozeMinutes: oneOf(state['snooze-minutes'], SNOOZE_LENGTHS, 5),
        openHudOnEnd: state['open-hud-on-end'] !== false,
        autoStartNextFocus: state['auto-start-next-focus'] === true,
        breakOptions: Object.freeze(options.length ? options : DEFAULT_BREAK_OPTIONS),
    });
}

/** A random v4 UUID, for a new break option's id. Not a secret. */
function uuid() {
    const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16));
    hex[12] = '4';
    hex[16] = (8 + Math.floor(Math.random() * 4)).toString(16);
    const h = hex.join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Preferences → Focus: the one place that writes the Focus settings, by the rules. Prefs
 * build one over their SettingsStore; FocusStore has one as `editor`.
 */
export class FocusSettingsEditor {
    #store;

    /** @param {import('./settings.js').SettingsStore} store */
    constructor(store) {
        this.#store = store;
    }

    /** The settings, by the rules. */
    get settings() {
        return readFocusSettings(this.#store.state);
    }

    setFocusLength(minutes) {
        if (FOCUS_LENGTHS.includes(minutes))
            this.#store.set('focus-length', minutes);
    }

    setSnoozeMinutes(minutes) {
        if (SNOOZE_LENGTHS.includes(minutes))
            this.#store.set('snooze-minutes', minutes);
    }

    setOpenHudOnEnd(on) {
        this.#store.set('open-hud-on-end', on === true);
    }

    setAutoStartNextFocus(on) {
        this.#store.set('auto-start-next-focus', on === true);
    }

    /** Add option: a blank label adds nothing. New options get the dot and go last. */
    addBreakOption(label, minutes = NEW_OPTION_LENGTH) {
        const trimmed = typeof label === 'string' ? label.trim() : '';
        if (!trimmed)
            return;
        const length = BREAK_LENGTHS.includes(minutes) ? minutes : NEW_OPTION_LENGTH;
        this.#write([...this.settings.breakOptions, {id: `custom-${uuid()}`, label: trimmed, icon: 'dot', minutes: length}]);
    }

    /** False while only one option is left: there is always one to pick. */
    get canRemoveBreakOption() {
        return this.settings.breakOptions.length > 1;
    }

    removeBreakOption(id) {
        if (this.canRemoveBreakOption)
            this.#write(this.settings.breakOptions.filter(o => o.id !== id));
    }

    /** An option's length, one of BREAK_LENGTHS (the prefs combo). */
    setBreakOptionLength(id, minutes) {
        if (BREAK_LENGTHS.includes(minutes))
            this.#write(this.settings.breakOptions.map(o => (o.id === id ? {...o, minutes} : o)));
    }

    /** The next length on an option: 2 → 5 → 10 → 20 → 50 → 2. */
    cycleBreakOptionLength(id) {
        const option = this.settings.breakOptions.find(o => o.id === id);
        if (option)
            this.setBreakOptionLength(id, BREAK_LENGTHS[(BREAK_LENGTHS.indexOf(option.minutes) + 1) % BREAK_LENGTHS.length]);
    }

    #write(options) {
        this.#store.set('break-options', options.map(({id, label, icon, minutes}) => ({id, label, icon, minutes})));
    }
}
