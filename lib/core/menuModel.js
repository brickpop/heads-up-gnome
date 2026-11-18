// The top bar menu's content at one moment (the Mac's MenuModel; UX §3). The shell builds its
// PopupMenu from it each time the menu opens. Rows for Caffeine, Services, Pinned Chats and
// Stop All Services join with their slices.
//
// An entry is {kind: 'header', title, shortcut} · {kind: 'row', action, title, value?,
// warning?} · {kind: 'separator'}. A row's `action` says what choosing it does: 'openHud'
// (the HUD on its last tab), 'focus' (the Focus tab), 'preferences'.

import * as format from './format.js';
import {Indicator, MenuBar, Tabs} from './strings.js';

/**
 * The Focus row's right side. Pauses, and prompts that wait or are snoozed, use the warn
 * colour, as the indicator does.
 */
export function focusValue(focus, now) {
    switch (focus.kind) {
    case 'idle': return {text: MenuBar.startFocus(focus.nextLength), warning: false};
    case 'running': return {text: `${MenuBar.kindTitle(focus.run)} · ${format.clock((focus.endsAt - now) / 1000)}`, warning: false};
    case 'paused': return {text: `${MenuBar.paused} · ${format.clock(focus.left)}`, warning: true};
    case 'prompt': return {text: focus.prompt === 'breakDue' ? MenuBar.breakDue : MenuBar.breakOver, warning: true};
    default: return {text: `${MenuBar.snoozed} · ${format.clock((focus.until - now) / 1000)}`, warning: true};
    }
}

/**
 * @param {object} input
 * @param {string} input.shortcut  accelLabel() of the wake shortcut while it works ('ok'), else ''
 * @param {object} input.focus  FocusStore.snapshot
 * @param {number} input.now  ms
 */
export function menuModel({shortcut, focus, now}) {
    const value = focusValue(focus, now);
    return [
        {kind: 'header', title: Indicator.appName, shortcut: shortcut || null},
        {kind: 'row', action: 'openHud', title: Indicator.openHud},
        {kind: 'separator'},
        {kind: 'row', action: 'focus', title: Tabs.title('focus'), value: value.text, warning: value.warning},
        {kind: 'separator'},
        {kind: 'row', action: 'preferences', title: Indicator.preferences},
    ];
}
