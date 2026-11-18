// What each notification category carries (the Mac's NotificationCategory; ADR-002 §6.7):
// its buttons, at most three. Titles and bodies come from strings.js only (G4).

import {Notifications} from './strings.js';

/** The buttons of each category, in order. */
export const CATEGORY_ACTIONS = Object.freeze({
    'focus.end': ['start-break', 'snooze', 'done'],
    'break.end': ['start-focus', 'snooze', 'done'],
    'break.autostart': ['stop'],
    'service.failed': ['show-logs'],
    'chat.reply': [],
});

/**
 * A notification for `Notifier.post()`.
 * @param {string} id  one per subject, e.g. "focus.timer": a new post replaces the last one
 */
export function notification(id, category, title, body) {
    return Object.freeze({
        id, category, title, body,
        actions: Object.freeze(CATEGORY_ACTIONS[category].map(action => Object.freeze({id: action, label: Notifications.action(action)}))),
    });
}
