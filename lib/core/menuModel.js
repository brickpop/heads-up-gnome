// The top bar menu's content at one moment (the Mac's MenuModel; UX §3). The shell builds its
// PopupMenu from it each time the menu opens. The Pinned Chats row joins with its slice.
//
// An entry is {kind: 'header', title, shortcut} · {kind: 'row', action, title, value?,
// warning?, switchOn?} · {kind: 'note', text} (a dim line under the row before it) ·
// {kind: 'separator'}. A row's `action` says what choosing it does: 'openHud' (the HUD on its
// last tab), 'focus' (the Focus tab), 'toggleCaffeine' (the switch), 'services' (the Services
// tab), 'preferences', 'stopAllServices' (shown only while one runs: it takes Quit's one job).

import * as format from './format.js';
import {Caffeine, Indicator, MenuBar, Services, Tabs, accelLabel} from './strings.js';

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
 * @param {object} input.caffeine  CaffeineStore.snapshot
 * @param {{running: number, starting: number, failed: number}} input.services  ServiceStore.snapshot
 * @param {number} input.now  ms
 */
export function menuModel({shortcut, focus, caffeine, services, now}) {
    const value = focusValue(focus, now);
    const held = caffeine.serviceHolds.filter(h => h.awake === 'holding').map(h => h.name);
    return [
        {kind: 'header', title: Indicator.appName, shortcut: shortcut || null},
        {kind: 'row', action: 'openHud', title: Indicator.openHud},
        {kind: 'separator'},
        {kind: 'row', action: 'focus', title: Tabs.title('focus'), value: value.text, warning: value.warning},
        {kind: 'row', action: 'toggleCaffeine', title: Tabs.title('caffeine'), switchOn: caffeine.on},
        ...held.length ? [{kind: 'note', text: Caffeine.keptAwakeBy(held)}] : [],
        {kind: 'row', action: 'services', title: Tabs.title('services'), value: Services.menuValue(services)},
        {kind: 'separator'},
        {kind: 'row', action: 'preferences', title: Indicator.preferences},
        ...services.running + services.starting > 0
            ? [{kind: 'separator'}, {kind: 'row', action: 'stopAllServices', title: Services.stopAll}]
            : [],
    ];
}

/**
 * The menu now, from every store: what the shell builds its PopupMenu from each time it opens.
 * The header names the shortcut while it works: the keys in force (`hud-shortcut-active`).
 */
export function menu({settings, focus, caffeine, services}, now) {
    const working = settings.state['hud-shortcut-status'] === 'ok';
    return menuModel({
        shortcut: working ? accelLabel(settings.state['hud-shortcut-active'][0] ?? '') : '',
        focus: focus.snapshot, caffeine: caffeine.snapshot, services: services.snapshot, now,
    });
}
