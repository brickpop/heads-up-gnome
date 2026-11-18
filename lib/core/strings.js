// Every string HeadsUp shows, as on the Mac (Strings.swift): views contain no literals.
// The copy comes from the UX design (gnome-ux.md); sections arrive slice by slice.

import {TABS} from './hud.js';

const MODIFIERS = {
    Shift: 'Shift', Control: 'Ctrl', Primary: 'Ctrl', Alt: 'Alt', Super: 'Super', Meta: 'Meta', Hyper: 'Hyper',
};
const KEYS = {
    space: 'Space', Return: 'Enter', KP_Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', BackSpace: 'Backspace',
    Page_Up: 'Page Up', Page_Down: 'Page Down', comma: ',', period: '.', slash: '/',
};

/** '<Shift><Super>space' → "Shift+Super+Space", as GNOME Settings writes keys; '' for none. */
export function accelLabel(accel) {
    if (typeof accel !== 'string' || !/^(<[A-Za-z]+>)*[A-Za-z0-9_]+$/.test(accel))
        return '';
    const mods = [];
    const key = accel.replace(/<([^>]+)>/g, (_, mod) => {
        mods.push(MODIFIERS[mod] ?? mod);
        return '';
    });
    const name = KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
    return [...mods, name].join('+');
}

/** The top bar indicator and its menu (UX §2, §3). */
export const Indicator = {
    appName: 'HeadsUp',
    idle: 'Idle',
    /** What Orca reads: the app's name, then each part, "HeadsUp, Idle". */
    accessibleName: parts => ['HeadsUp', ...parts].join(', '),
    openHud: 'Open HeadsUp',
    preferences: 'Preferences',
    pinnedChats: 'Pinned Chats',
};

export const Common = {
    openPreferences: 'Open Preferences',
    dismiss: 'Dismiss',
};

export const Tabs = {
    title: tab => ({chat: 'Chat', focus: 'Focus', caffeine: 'Caffeine', services: 'Services', commands: 'Commands'})[tab],
    /** "Focus · Ctrl+2" */
    tooltip: tab => `${Tabs.title(tab)} · Ctrl+${TABS.indexOf(tab) + 1}`,
};

export const Prompt = {
    chatNoModel: 'Add a model to chat',
    otherTab: 'Search actions or ask…',
    /** The prompt field, for Orca. */
    accessibleName: 'Ask or search',
};

/** Footer hints: one keycap per key (UX §6). */
export const Hints = {
    /** Any tab, the prompt empty. */
    tabs: [{keys: ['Ctrl', 'PgUp', 'PgDn'], label: 'tabs'}, {keys: ['/'], label: 'actions'}, {keys: ['Esc'], label: 'close'}],
    /** Any tab, text in the prompt and no rows. */
    typing: [{keys: ['Ctrl', '1–5'], label: 'switch'}, {keys: ['/'], label: 'actions'}, {keys: ['Esc'], label: 'close'}],
    suggestions: [{keys: ['↑↓'], label: 'navigate'}, {keys: ['Enter'], label: 'run'}, {keys: ['Esc'], label: 'clear'}],
    noMatch: [{keys: ['Esc'], label: 'clear'}],
    /** The Focus tab while idle, the prompt empty. */
    focusCards: [{keys: ['Alt', '←→'], label: 'choose'}, {keys: ['Ctrl', 'Enter'], label: 'start'}, {keys: ['Esc'], label: 'close'}],
    /** The Focus tab's two prompts, the prompt empty. The Start button shows its own keys. */
    focusPrompt: [{keys: ['Alt', '←→'], label: 'choose'}, {keys: ['Alt', 'Shift', '←→'], label: 'snooze length'}, {keys: ['Esc'], label: 'snooze'}],
};

/** The first-run welcome (UX §7). */
export const Welcome = {
    title: 'Welcome to HeadsUp',
    /** The first line, by `hud-shortcut-status`; `shortcut` is accelLabel() of the current one. */
    line(status, shortcut) {
        if (status === 'ok')
            return `Press ${shortcut} in any app to open this.`;
        if (status === 'layouts')
            return `${shortcut || 'Super+Space'} switches your keyboard layout. You can let HeadsUp use it in Preferences.`;
        if (!shortcut)
            return "Your shortcut isn't working. Choose a shortcut in Preferences.";
        return `${shortcut} isn't working. Choose a shortcut in Preferences.`;
    },
    /** Open Preferences shows only for these. */
    needsPreferences: status => status !== 'ok',
    addModel: 'Add a model to chat with',
    setUpModel: 'Set up a model',
    changeLater: 'You can change this later in Preferences.',
};

/** The one-time notice bar in the HUD (UX §7). */
export const LayoutNotice = {
    text: 'You added a keyboard layout, so Super+Space switches layouts again.',
};

/** Preferences → General → Wake Shortcut (UX §7). */
export const Shortcut = {
    title: 'Wake Shortcut',
    /** The note under the row, or null. `shortcut` is accelLabel() of the current one. */
    note(status, holder, shortcut) {
        switch (status) {
        case 'layouts':
            return "Super+Space switches your keyboard layout, so HeadsUp can't use it.";
        case 'in-use':
            return `GNOME uses ${shortcut} for ${holder}. Choose another shortcut.`;
        case 'failed':
            return "This shortcut couldn't be set up. Choose another one.";
        default:
            return null;
        }
    },
    /** Under the `layouts` note, in --ink-2. */
    layoutsDetail: 'If HeadsUp takes it, layouts switch with Shift+Super+Space.',
    /** The row's subtitle while HeadsUp holds Super+Space with consent. */
    takenSubtitle: 'Layouts switch with Shift+Super+Space.',
    useButton: 'Use Super+Space for HeadsUp',
    giveBackButton: 'Give Super+Space Back to Layout Switching',
    offBanner: 'HeadsUp is turned off. Changes apply when you turn it on.',
};

/** The dialog that records a new wake shortcut (UX §7). */
export const Recorder = {
    title: 'Press the new shortcut',
    cancel: 'Cancel',
    save: 'Save',
    needsModifier: 'Use it with Ctrl, Alt or Super.',
    usedByHeadsUp: 'HeadsUp uses this shortcut in its window. Choose another shortcut.',
    inUse: (keys, action) => `GNOME uses ${keys} for ${action}. Choose another shortcut.`,
    invalid: "This shortcut couldn't be set up. Choose another one.",
    /** The line for a recorderProblem() result; `keys` is accelLabel() of the recorded keys. */
    problem(problem, keys) {
        switch (problem.kind) {
        case 'needs-modifier': return Recorder.needsModifier;
        case 'used-by-headsup': return Recorder.usedByHeadsUp;
        case 'in-use': return Recorder.inUse(keys, problem.holder);
        default: return Recorder.invalid;
        }
    },
};

/** Preferences → General, the other slice 0 rows (UX §9). */
export const General = {
    title: 'General',
    appearance: 'Appearance',
    appearanceSubtitle: 'For the HeadsUp window',
    appearanceOptions: {system: 'System', light: 'Light', dark: 'Dark'},
    closeOnClickOutside: 'Close When You Click Elsewhere',
    /** `shortcut` is accelLabel() of the current one, or null while no shortcut works. */
    closeOnClickOutsideSubtitle: shortcut =>
        shortcut ? `Off: it stays open until you press Esc or ${shortcut}` : 'Off: it stays open until you press Esc',
};

/** Focus: the tab, its prompts, toasts and actions (the Mac's Strings.Focus). */
export const Focus = {
    // Toasts
    focusStarted: minutes => `Focus started · ${minutes} min`,
    breakStarted: minutes => `Break started · ${minutes} min`,
    snoozed: minutes => `Snoozed for ${minutes} min`,
    /** The toast when a session ends while the user works in the open HUD. */
    focusDoneAnnouncement: 'Focus done · time for a break',
    breakOverAnnouncement: 'Break over',
    /** The toast when a snoozed break prompt returns to an open HUD in use. */
    snoozeOverBreakAnnouncement: 'Time for a break',

    // Footer pill
    pillFocus: clock => `Focus ${clock}`,
    pillBreak: clock => `Break ${clock}`,
    pillSnoozed: clock => `Snoozed ${clock}`,

    // Actions
    startAction: minutes => `Start ${minutes} min focus`,
    startSubtitle: 'pomodoro · focus session',
    stopAction: 'Stop timer',
    stopSubtitle: isBreak => `pomodoro · ${isBreak ? 'break' : 'focus'}`,
    breakNowAction: 'Take a break now',
    breakNowSubtitle: 'pomodoro · break options',
    takeBreakAction: minutes => `Take a ${minutes} min break`,
    /** "focus · ends 3:42 PM" */
    endsSubtitle: (isBreak, time) => `${isBreak ? 'break' : 'focus'} · ends ${time}`,
    /** "replaces your focus · 12 min left": Enter replaces what runs. */
    replaces: (isBreak, minutesLeft) => `replaces your ${isBreak ? 'break' : 'focus'} · ${minutesLeft} min left`,
    anyLengthBounds: kind => (kind === 'focus' ? 'A focus can be 1 to 180 minutes' : 'A break can be 1 to 60 minutes'),
    typeTheMinutes: kind => `Type the minutes, like ${kind === 'focus' ? '/start 35' : '/break 5'}`,

    // Idle
    idleLabel: 'Focus session',
    /** The manual break prompt's label before any session today. */
    noSessionsYet: 'No sessions yet today',
    /** "2 sessions · 1h 05m focused today" (`minutesText` is format.minutes() of the total, or "0m"). */
    todayStats: (sessions, minutesText) => `${sessions === 1 ? '1 session' : `${sessions} sessions`} · ${minutesText} focused today`,
    lengthHint: minutes => ({25: 'Classic pomodoro', 40: 'Steady block'})[minutes] ?? 'Deep work',
    minutes: minutes => `${minutes} min`,
    /** What Orca says for a length or break option card: "40 min, Steady block, selected". */
    cardAccessible: (title, hint, selected) => (selected ? `${title}, ${hint}, selected` : `${title}, ${hint}`),
    /** "Breaks offer: look elsewhere, drink water, stretch your arms…" */
    breaksOffer: labels => `Breaks offer: ${labels.slice(0, 3).map(l => l.toLowerCase()).join(', ')}${labels.length > 3 ? '…' : ''}`,
    startFocus: 'Start focus',
    /** The keycaps on a primary button: Ctrl+Enter runs it from the prompt. */
    primaryShortcut: ['Ctrl', 'Enter'],
    /** Orca's hint on those buttons. */
    primaryShortcutHint: 'Control-Return',

    // Running
    focusing: 'Focusing',
    focusPaused: 'Focus · paused',
    breakPaused: 'Break · paused',
    /** Orca, for the big timer: "18 minutes left". */
    timeLeftAccessible: spoken => `${spoken} left`,
    breakLabel: activity => `Break · ${activity}`,
    /** "25 min session · break at 15:30" */
    sessionSubtitle: (minutes, breakAt) => `${minutes} min session · break at ${breakAt}`,
    breakSubtitle: 'Step away. The HUD will call you back.',
    takeBreak: 'Take a break',
    skipBreak: 'Skip break',
    pause: 'Pause',
    resume: 'Resume',
    /** Ends the loop, back to idle: the snooze group's last segment, and next to Pause. */
    stopNow: 'Stop now',
    stopNowHelp: 'Stop here. Nothing else starts.',

    // Break prompt
    sessionDone: (minutes, today) => `${minutes} min session done · ${today} today`,
    timeForABreak: 'Time for a break',
    length: 'Length',
    lengthChoice: minutes => `${minutes}m`,
    lengthAccessible: minutes => `${minutes} minutes`,
    lengthGroupAccessible: 'Break length',
    snooze: 'Snooze',
    snoozeChoice: minutes => `${minutes}m`,
    snoozeAccessible: minutes => `Snooze, ${minutes} minutes`,
    startBreak: 'Start break',

    // Back prompt
    breakFinished: 'Break finished',
    readyToGetBack: 'Ready to get back to it?',
    /** The hint on the back prompt's extra card: the last focus's typed length. */
    lastFocusHint: 'Last focus',

    // Snoozed
    snoozedLabel: 'Snoozed',
    promptReturns: clock => `Prompt returns in ${clock}`,
    showNow: 'Show now',
};

/** Notifications: fixed copy only (G4), filled with numbers or names the user set. */
export const Notifications = {
    source: 'HeadsUp',
    focusDoneTitle: minutes => `Focus done · ${minutes} min`,
    focusDoneBody: 'Time for a break.',
    breakOverTitle: 'Break over',
    breakOverBody: 'Ready to get back to it?',
    snoozeOverBreakTitle: 'Time for a break',
    snoozeOverBreakBody: focusMinutes => (focusMinutes ? `Snooze is over. Your ${focusMinutes} min focus is done.` : 'Snooze is over.'),
    snoozeOverBackBody: 'Snooze is over. Ready to get back to it?',
    focusStartedBody: minutes => Focus.focusStarted(minutes),
    /** Button labels, in title case as GNOME's are (UX §8). */
    action: id => ({
        'start-break': 'Start Break', 'start-focus': 'Start Focus', 'snooze': 'Snooze',
        'done': 'Stop Now', 'stop': 'Stop', 'show-logs': 'Show Logs',
    })[id],
};

/** The top bar indicator's words and its menu (the Mac's Strings.MenuBar; UX §2, §3). */
export const MenuBar = {
    paused: 'Paused',
    snoozed: 'Snoozed',
    breakDue: 'Break due',
    breakOver: 'Break over',
    noFocus: 'No focus',
    startFocus: minutes => `Start ${minutes} min`,
    /** "Focus" or "Break", as a menu value starts. */
    kindTitle: kind => (kind === 'focus' ? 'Focus' : 'Break'),
    /** "focus" or "break", inside a sentence for Orca. */
    kindName: kind => (kind === 'focus' ? 'focus' : 'break'),
};

/** The suggestion rows under the prompt (the Mac's Strings.Suggestions). */
export const Suggestions = {
    noMatch: 'No matching actions',
    accessibleName: 'Suggestions',
    /** The keycap on the selected row. */
    runKey: 'Enter',
    ask: model => `Ask ${model}`,
    setUpModel: 'Set up a model to chat',
    setUpModelSubtitle: 'Preferences → Chat',
    /** The input in curly quotes, cut to `limit` characters plus "…". */
    quote: (text, limit) => `“${[...text].length > limit ? `${[...text].slice(0, limit).join('')}…` : text}”`,
    /** Orca, for a row: "Start 25 min focus, Focus, 1 of 6". */
    accessibleRow: (title, kind, position, count) => `${title}, ${kind}, ${position} of ${count}`,
};

/** An action's kind, on the right of its row; the search matches it too. */
export const ActionKinds = {
    label: kind => ({
        chat: 'Chat', focus: 'Focus', caffeine: 'Caffeine', model: 'Model', service: 'Service',
        command: 'Command', view: 'View', action: 'Action',
    })[kind],
};

/** Preferences → Focus (the Mac's Strings.FocusSettings; UX §9). */
export const FocusPrefs = {
    title: 'Focus & breaks',
    intro: 'Options shown when a focus session ends.',
    breakOptions: 'Break options',
    /** The remove button's accessible name: "Remove Drink water". */
    removeOption: label => `Remove ${label}`,
    focusLength: 'Focus length',
    autoStart: 'Start the next focus after a break',
    autoStartHelp: 'Skips “Ready to get back to it?”',
    snoozeLength: 'Snooze length',
    openHud: 'Open the HUD when a session ends',
    openHudHelp: 'Otherwise only a notification is sent',
    addPlaceholder: 'Add an option, e.g. Walk around the block',
    remove: 'Remove',
    keepOne: 'Keep at least one option',
    minutesShort: minutes => `${minutes}m`,
    minutes: minutes => `${minutes} min`,
};
