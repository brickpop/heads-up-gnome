// The HUD's own keys (UX §6; ADR-002 §4): one table, read by the key handler and by the
// shortcut recorder, which refuses these keys as a wake shortcut. Also the one spelling of an
// accelerator for comparing keys.

import {TABS} from './hud.js';
import {Hints} from './strings.js';

const ACCEL = /^(<(Shift|Control|Primary|Alt|Super|Meta|Hyper)>)*[A-Za-z0-9_]+$/;

/** True for an accelerator HeadsUp may write to GNOME's settings (G8b). */
export function validAccel(accel) {
    return typeof accel === 'string' && ACCEL.test(accel);
}

/** One spelling per key combination: "<Primary><super>Space" and "<Super><Control>space" match. */
export function normalizeAccel(accel) {
    const mods = [];
    const key = accel.replace(/<([^>]+)>/g, (_, mod) => {
        mods.push(mod.toLowerCase() === 'primary' ? 'control' : mod.toLowerCase());
        return '';
    });
    return [...new Set(mods)].sort().concat(key.toLowerCase()).join('+');
}

/**
 * The keys the HUD handles while it has the keyboard. `promptEmpty`: only while the prompt
 * holds no text (otherwise the field moves by word). New Chat, Pin and Stop act from slice 5.
 */
export const HUD_KEYS = Object.freeze([
    ...TABS.map((_, i) => ({accel: `<Control>${i + 1}`, command: `tab:${i + 1}`})),
    {accel: '<Control>Page_Down', command: 'tab:next'},
    {accel: '<Control>Page_Up', command: 'tab:prev'},
    {accel: '<Control>Return', command: 'primary'},
    {accel: '<Control>KP_Enter', command: 'primary'},
    {accel: '<Control>comma', command: 'preferences'},
    {accel: '<Control>n', command: 'newChat'},
    {accel: '<Control>p', command: 'pin'},
    {accel: '<Control>period', command: 'stop'},
    {accel: 'Up', command: 'select:prev'},
    {accel: 'Down', command: 'select:next'},
    {accel: '<Alt>Left', command: 'card:prev', promptEmpty: true},
    {accel: '<Alt>Right', command: 'card:next', promptEmpty: true},
    {accel: '<Alt><Shift>Left', command: 'snooze:prev', promptEmpty: true},
    {accel: '<Alt><Shift>Right', command: 'snooze:next', promptEmpty: true},
].map(Object.freeze));

const BY_ACCEL = new Map(HUD_KEYS.map(entry => [normalizeAccel(entry.accel), entry]));

/**
 * A key pressed in the HUD (the Mac's handleShortcut). `key` is the key's name as GDK writes
 * it ("1", "Page_Up", "Return", "comma", "Left"). Returns true when the HUD handled it;
 * otherwise it goes on to the prompt field.
 * @param {{hud: import('./hud.js').HudStore, focus: import('./focus.js').FocusStore,
 *   caffeine: import('./caffeine.js').CaffeineStore, preferences: import('./ports.js').Preferences}} stores
 * @param {{key: string, ctrl?: boolean, alt?: boolean, shift?: boolean}} event
 * @param {boolean} promptEmpty
 */
export function handleKey({hud, focus, caffeine, preferences}, {key, ctrl = false, alt = false, shift = false}, promptEmpty) {
    const accel = `${ctrl ? '<Control>' : ''}${alt ? '<Alt>' : ''}${shift ? '<Shift>' : ''}${key}`;
    const entry = BY_ACCEL.get(normalizeAccel(accel));
    if (!entry || (entry.promptEmpty && !promptEmpty))
        return false;
    const onFocus = hud.state.tab === 'focus';
    const [command, arg] = entry.command.split(':');
    switch (command) {
    case 'tab':
        if (arg === 'next')
            hud.nextTab();
        else if (arg === 'prev')
            hud.previousTab();
        else
            hud.selectTab(TABS[Number(arg) - 1]);
        return true;
    case 'primary':
        if (hud.state.tab === 'caffeine') {
            // Starts with the selected duration, or stops; with text, the key is the prompt's.
            if (!promptEmpty)
                return false;
            caffeine.toggle();
            return true;
        }
        return onFocus && focus.runPrimaryAction();
    case 'preferences':
        hud.hide();
        preferences.open();
        return true;
    case 'card':
        if (hud.state.tab === 'caffeine') {
            caffeine.moveDurationSelection(arg === 'next' ? 1 : -1);
            return true;
        }
        return onFocus && focus.moveCardSelection(arg === 'next' ? 1 : -1);
    case 'select':
        // ↑ ↓ move through the suggestions while there are any; else they stay the field's.
        if (!hud.state.suggestions.length)
            return false;
        hud.moveSelection(arg === 'next' ? 1 : -1);
        return true;
    case 'snooze':
        return onFocus && focus.moveSnoozeSelection(arg === 'next' ? 1 : -1);
    default:
        // newChat, pin, stop: the chat's keys, from slice 5.
        return false;
    }
}

/** Esc: clears the prompt; else snoozes a Focus prompt; else hides the HUD. */
export function escape({hud, focus}) {
    if (hud.state.input)
        hud.setInput('');
    else if (hud.state.tab === 'focus' && focus.showsPrompt)
        focus.snooze();
    else
        hud.hide();
}

/**
 * The footer's left side (the Mac's footerLeft): a toast, or the hints for what shows.
 * @returns {{toast: {text, seq}} | {hints: {keys: string[], label: string}[]}}
 */
export function footer({hud, focus, caffeine}) {
    const {toast, input, suggestions, tab} = hud.state;
    if (toast)
        return {toast};
    if (suggestions.length)
        return {hints: suggestions[0].kind === 'noMatch' ? Hints.noMatch : Hints.suggestions};
    if (input)
        return {hints: Hints.typing};
    if (tab === 'focus' && focus.showsPrompt)
        return {hints: Hints.focusPrompt};
    if (tab === 'focus' && focus.showsCards)
        return {hints: Hints.focusCards};
    if (tab === 'caffeine')
        return {hints: caffeine.isOn ? Hints.caffeineOn : Hints.caffeineOff};
    return {hints: Hints.tabs};
}
