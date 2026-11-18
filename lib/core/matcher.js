// Turns the prompt's text into suggestion rows (the Mac's Matcher; Action autocomplete spec).
// Pure: the same input always gives the same rows.
//
// A row is {kind: 'ask', title, subtitle} · {kind: 'action', action} · {kind: 'noMatch', text},
// and a 'noMatch' row can't be selected.

import {ANY_BREAK_RANGE, ANY_FOCUS_RANGE} from './focusSettings.js';
import {ActionKinds, Focus, Suggestions} from './strings.js';

export const SLASH_LIMIT = 9;
export const FREE_TEXT_LIMIT = 6;
/** The Ask row quotes at most this many characters of the input. */
const QUOTE_LIMIT = 60;

/**
 * `/start 35` or `/break 5 min`: a focus or a break of any length (the Mac's QuickTimer).
 * `/start` or `/break`, one space, whole minutes, then optionally `m` or `min`; any case.
 * @returns {{kind: 'focus'|'break', minutes} | {kind: 'invalid', of: 'focus'|'break', text} | null}
 *   null for any other input, the command word alone included (it still filters the catalogue)
 */
export function parseQuickTimer(query) {
    const lowered = query.toLowerCase();
    const kind = lowered.startsWith('/start ') ? 'focus' : lowered.startsWith('/break ') ? 'break' : null;
    if (!kind)
        return null;
    const argument = lowered.slice(7).trim();
    const digits = argument.match(/^[0-9]*/)[0];
    const unit = argument.slice(digits.length).trim();
    if (!digits || !['', 'm', 'min'].includes(unit))
        return {kind: 'invalid', of: kind, reason: 'notANumber', text: Focus.typeTheMinutes(kind)};
    const [low, high] = kind === 'focus' ? ANY_FOCUS_RANGE : ANY_BREAK_RANGE;
    const minutes = digits.length > 6 ? Infinity : Number(digits);
    if (minutes < low || minutes > high)
        return {kind: 'invalid', of: kind, reason: 'outOfRange', text: Focus.anyLengthBounds(kind)};
    return {kind, minutes};
}

/** The actions where every word of `query` is in the title, the keywords or the kind. */
export function filter(actions, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return actions.filter(action => {
        const text = `${action.title} ${action.keywords} ${ActionKinds.label(action.kind)}`.toLowerCase();
        return words.every(word => text.includes(word));
    });
}

/**
 * The Ask row: the model, or the way to set one up. `ask` is {model: name}, null (no model
 * yet), or undefined (no chat at all yet: no Ask row).
 */
function askRow(query, ask) {
    if (ask === undefined)
        return [];
    return [ask
        ? {kind: 'ask', title: Suggestions.ask(ask.model), subtitle: Suggestions.quote(query, QUOTE_LIMIT)}
        : {kind: 'ask', title: Suggestions.setUpModel, subtitle: Suggestions.setUpModelSubtitle}];
}

const actionRow = action => ({kind: 'action', action});

/**
 * @param {string} input  the prompt's text, as typed
 * @param {object[]} actions  the catalogue, in catalogue order
 * @param {object} options
 * @param {{model: string} | null | undefined} options.ask  who the Ask row asks; undefined: no Ask row
 * @param {boolean} options.inConversation  the Chat tab shows a conversation: free text then
 *   shows rows only when actions match, so typing a reply isn't hidden behind them
 * @param {{timer: object, action: object | null} | null} [options.typed]  the input parsed by
 *   parseQuickTimer, and the row that starts it when it is valid
 */
export function match(input, actions, {ask, inConversation, typed = null}) {
    const query = input.trim();
    if (!query)
        return [];
    if (query.startsWith('/')) {
        const found = filter(actions, query.slice(1));
        if (typed?.action)
            return [actionRow(typed.action)];
        const timer = typed?.timer;
        // Words that still filter the catalogue ("/start foc") keep doing so.
        if (timer?.kind === 'invalid' && !(timer.reason === 'notANumber' && found.length))
            return [{kind: 'noMatch', text: timer.text}, ...askRow(query, ask)];
        // A typo like "/fcous" must not be sent to the model by Enter: nothing is selected.
        if (!found.length)
            return [{kind: 'noMatch', text: Suggestions.noMatch}, ...askRow(query, ask)];
        return found.slice(0, SLASH_LIMIT).map(actionRow);
    }
    if ([...query].length < 2)
        return inConversation ? [] : askRow(query, ask);
    const found = filter(actions, query);
    if (inConversation && !found.length)
        return [];
    if (!found.length && ask === undefined)
        return [];
    return [...askRow(query, ask), ...found.slice(0, FREE_TEXT_LIMIT - (ask === undefined ? 0 : 1)).map(actionRow)];
}
