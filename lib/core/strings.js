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
    copyAll: 'Copy All',
    copied: 'Copied to clipboard',
    tooLong: 'Too long to show in full.',
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
    /** The Caffeine tab, the prompt empty, while off and while on. */
    caffeineOff: [{keys: ['Alt', '←→'], label: 'choose'}, {keys: ['Ctrl', 'Enter'], label: 'start'}, {keys: ['Esc'], label: 'close'}],
    caffeineOn: [{keys: ['Alt', '←→'], label: 'choose'}, {keys: ['Ctrl', 'Enter'], label: 'stop'}, {keys: ['Esc'], label: 'close'}],
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
    caffeineOn: 'caffeine on',
    caffeinePaused: 'caffeine paused on battery',
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

/** Caffeine (the Mac's Strings.Caffeine, in GNOME's words: UX §13). */
export const Caffeine = {
    // Toasts
    onBySwitch: 'Caffeine on. Your computer stays awake',
    onPausedBySwitch: 'Caffeine on · paused until you plug in',
    onPaused: label => `Caffeine on · ${label} · paused until you plug in`,
    off: 'Caffeine off',
    onByCard: duration => `Caffeine on · ${Caffeine.cardTitle(duration)}`,
    onByAction: duration => `Caffeine on · ${Caffeine.actionSuffix(duration)}`,
    extended: minutes => (minutes === 60 ? 'Caffeine extended by 1 hour' : `Caffeine extended by ${minutes} min`),

    // Footer pill
    pillAwake: left => (left ? `Awake ${left}` : 'Awake'),
    pillPaused: left => (left ? `Paused ${left}` : 'Paused'),

    // Header
    titleOn: 'Staying awake',
    titleOff: 'Caffeine is off',
    /** The reason of Caffeine's inhibitors in `gnome-session-inhibit --list`. */
    holdName: 'Caffeine',

    // Services that keep the computer awake
    serviceList: names => (names.length <= 1 ? names[0] ?? ''
        : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`),
    keptAwakeBy: names => (names.length === 1 ? `Kept awake by ${names[0]}` : `Kept awake by ${names.length} services`),
    keptAwakeBySpoken: names => (names.length === 1 ? `kept awake by ${names[0]}` : `kept awake by ${names.length} services`),
    subtitleKeptAwake: names => (names.length === 1
        ? 'Caffeine is off. Your computer stays awake while it runs.'
        : `Caffeine is off. ${Caffeine.serviceList(names)} keep your computer awake while they run.`),
    alsoKeeps: names => (names.length === 1
        ? `${names[0]} also keeps your computer awake while it runs.`
        : `${Caffeine.serviceList(names)} also keep your computer awake while they run.`),
    subtitleHeldPaused: names => `${Caffeine.serviceList(names)} would keep your computer awake. Resumes on power.`,
    refusedFor: names => `GNOME didn't let HeadsUp keep your computer awake for ${Caffeine.serviceList(names)}.`,
    titlePaused: 'Paused on battery',
    subtitleOff: 'Your computer dims the screen and sleeps as usual.',
    subtitleUntilOff: 'Until you turn it off',
    /** "45m left · ends at 15:30" */
    subtitleLeft: (left, endsAt) => `${left} left · ends at ${endsAt}`,
    resumesOnPower: 'Resumes on power',
    subtitlePaused: (left, endsAt) => `Resumes on power · ${left} left · ends at ${endsAt}`,
    switchLabel: 'Caffeine',

    // Extend row
    needLonger: 'Need a bit longer?',
    plus: minutes => (minutes === 60 ? '+1 h' : `+${minutes} min`),

    // Durations
    keepAwakeFor: 'Keep awake for',
    cardTitle: duration => ({'15m': '15 min', '1h': '1 hour', '2h': '2 hours', 'until-off': 'Until off'})[duration],
    cardAccessible: (duration, selected) => (selected ? `${Caffeine.cardTitle(duration)}, selected` : Caffeine.cardTitle(duration)),

    // Options
    keepDisplayOn: 'Keep the screen on',
    keepDisplayOnHelp: "The screen doesn't dim, blank or lock.",
    preventSystemSleep: 'Prevent system sleep',
    preventSystemSleepHelp: 'Keeps background jobs and services running',
    onlyOnAC: 'Only on power adapter',
    onlyOnACHelp: 'Pauses on battery. This also pauses services that keep your computer awake.',
    keepOneOn: 'Keep at least one on.',
    /** The note under the header when GNOME refuses, with Try Again. */
    holdNote: problem => ({
        refused: "GNOME didn't let HeadsUp keep your computer awake.",
        displayRefused: "GNOME didn't let HeadsUp keep the screen on.",
        systemRefused: "GNOME didn't let HeadsUp keep your computer from sleeping.",
    })[problem],
    tryAgain: 'Try Again',

    // Actions
    keepAwakeAction: duration => `Keep awake ${Caffeine.actionSuffix(duration)}`,
    keepAwakeSubtitle: 'caffeine · prevent sleep',
    extendAction: minutes => (minutes === 60 ? 'Add 1 hour to caffeine' : `Add ${minutes} min to caffeine`),
    extendSubtitle: 'caffeine · extend current timer',
    offAction: 'Caffeine off',
    offSubtitle: 'allow sleep again',
    actionSuffix: duration => ({'15m': 'for 15 min', '1h': 'for 1 hour', '2h': 'for 2 hours', 'until-off': 'until turned off'})[duration],
};

/** The service and command editors' shared copy (the Mac's Strings.ListForm). */
export const ListForm = {
    name: 'Name',
    command: 'Command',
    folder: 'Folder',
    choose: 'Choose…',
    remove: 'Remove',
    cancel: 'Cancel',
    save: 'Save',
    removeQuestion: name => `Remove ${name}?`,
    removeConfirm: 'Remove',
    nameEmpty: 'Enter a name.',
    nameTooLong: 'Use 64 characters or fewer.',
    commandProblem: 'Enter a command to run.',
    folderMissing: "This folder doesn't exist.",
    nulProblem: "This has a hidden character that can't be used. Type it again.",
    /** A problem as a row's reason: lower case, no full stop ("enter a command to run"). */
    inline: problem => {
        const reason = problem.endsWith('.') ? problem.slice(0, -1) : problem;
        return reason.charAt(0).toLowerCase() + reason.slice(1);
    },
};

/** Services (the Mac's Strings.Services, in GNOME's words: UX §13). */
export const Services = {
    // Form problems (the shared ones are in ListForm)
    portProblem: 'Enter a port from 1 to 65535, or leave it empty.',
    envKeyProblem: "Use only letters, digits and _, and don't start with a digit.",
    /** An entry whose id isn't a UUID (G10): only a hand-edited setting has one. */
    idProblem: "This service's id isn't valid. Remove it and add it again.",
    /** "Can't start · enter a command to run" */
    cantStart: problem => `Can't start · ${ListForm.inline(problem)}`,

    // Log lines
    commandLine: command => `$ ${command}`,
    starting: 'starting…',
    exited: code => `process exited (code ${code})`,
    killed: signal => `process exited (${signal})`,
    shellFallback: shell => `${shell} isn't supported for services; running in bash`,
    couldNotStart: reason => `couldn't start: ${reason}`,
    restartingIn: (seconds, attempt, total) => `restarting in ${seconds} s (restart ${attempt} of ${total})`,
    gaveUpLog: restarts => `stopped again after ${restarts} restarts; not restarting`,
    restartCancelled: 'restart cancelled',
    keepingAwake: 'keeping the computer awake',
    noLongerKeepingAwake: 'no longer keeping the computer awake',
    keepingAwakePaused: 'keeping awake paused: on battery',
    keepingAwakeResumed: 'keeping awake resumed: on power',
    keepAwakeRefused: "GNOME didn't let HeadsUp keep the computer awake",
    awayFor: limit => `no longer keeping the computer awake: away for ${Services.keepAwakeChoice(limit)}`,
    back: "keeping the computer awake again: you're back",

    // Toasts
    started: name => `Started ${name}`,
    stopped: name => `Stopped ${name}`,
    added: name => `Added ${name}`,
    saved: name => `Saved ${name}`,
    removed: name => `Removed ${name}`,
    stoppedAll: 'Stopped all services',

    // The tab
    tabLabel: running => `Services · ${running} running`,
    tabNote: 'Logs are always recorded, hidden until you open them',
    emptyTitle: 'No services yet',
    emptyText: 'Add a dev server, a database or a local model, then start and stop it here.',
    addService: 'Add a service…',
    edit: 'Edit…',
    noOutput: 'No output yet. Start the service to see its logs.',
    logs: 'Logs',
    logsHelp: isOpen => (isOpen ? 'Hide Logs' : 'Show Logs'),
    clear: 'Clear',
    startingMeta: port => (port ? `Starting… waiting for :${port}` : 'Starting…'),
    runningMeta: (port, uptime) => (port ? `:${port} · ${uptime}` : uptime),
    silentMeta: port => `Running · nothing on :${port} yet`,
    portLabel: port => `:${port}`,
    openLocalhost: port => `Open localhost:${port}`,
    openInBrowser: 'Open in browser',
    failedMeta: (code, ago) => `Exited with code ${code} · ${ago}`,
    restartingMeta: (seconds, exit) => `Restarting in ${seconds} s · ${exit}`,
    gaveUpMeta: (time, restarts) => `Kept stopping since ${time} · gave up after ${restarts} restarts`,
    /** "exited with code 1", or "stopped by SIGTERM" (code 128 + the signal). */
    exitPhrase: code => (code >= 129 && code <= 159 ? `stopped by ${Services.signalName(code - 128)}` : `exited with code ${code}`),
    signalName: signal => ({15: 'SIGTERM', 9: 'SIGKILL', 2: 'SIGINT', 1: 'SIGHUP'})[signal] ?? `signal ${signal}`,
    restartingAccessible: seconds => (seconds === 1 ? 'restarting in 1 second' : `restarting in ${seconds} seconds`),
    keepAwakeIdleHelp: 'Keeps your computer awake while it runs',
    restartsHelp: 'Restarts if it stops',
    /** The cup's tooltip by the hold's state ('holding', 'pausedOnBattery', 'refused', or null). */
    keepAwakeTooltip: (awake, limit = 'unlimited', away = false) => {
        if (awake === 'holding')
            return 'Keeping your computer awake';
        if (awake === 'pausedOnBattery')
            return 'Keeping awake is paused on battery';
        if (awake === 'refused')
            return "GNOME didn't let HeadsUp keep your computer awake";
        if (away)
            return 'Not keeping your computer awake while you\'re away';
        return KEEP_AWAKE_MINUTES[limit] ? `${Services.keepAwakeIdleHelp}, until you've been away ${Services.keepAwakeChoice(limit)}` : Services.keepAwakeIdleHelp;
    },
    /** The row's name for the screen reader: "Web dev server, running, keeping your computer awake, restarts if it stops". */
    rowAccessible: ({name, status, keepsAwake, awake = null, limit = 'unlimited', away = false, restarts}) => {
        const parts = [name, status];
        if (keepsAwake) {
            if (awake === 'holding')
                parts.push('keeping your computer awake');
            else if (awake === 'pausedOnBattery')
                parts.push('keeping awake is paused on battery');
            else if (awake === 'refused')
                parts.push("can't keep your computer awake");
            else if (away)
                parts.push("not keeping your computer awake while you're away");
            else if (KEEP_AWAKE_MINUTES[limit])
                parts.push(`keeps your computer awake while it runs, until you've been away ${Services.keepAwakeChoiceSpoken(limit)}`);
            else
                parts.push('keeps your computer awake while it runs');
        }
        if (restarts)
            parts.push('restarts if it stops');
        return parts.join(', ');
    },
    /** "just now", "12 min ago", "5 h ago", "yesterday", then the short local date. */
    ago: (date, now) => {
        const minutes = Math.floor((now - date) / 60_000);
        if (minutes < 1)
            return 'just now';
        if (minutes < 60)
            return `${minutes} min ago`;
        if (minutes < 24 * 60)
            return `${Math.floor(minutes / 60)} h ago`;
        if (minutes < 48 * 60)
            return 'yesterday';
        const d = new Date(date);
        return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
    },
    keepAwakeChoice: limit => ({'off': 'Off', '30m': '30m', '2h': '2h', '5h': '5h', 'unlimited': 'Unlimited'})[limit],
    keepAwakeChoiceSpoken: limit => ({'30m': '30 minutes', '2h': '2 hours', '5h': '5 hours'})[limit] ?? '',

    // Actions
    startAction: name => `Start ${name}`,
    stopAction: name => `Stop ${name}`,
    restartAction: name => `Restart ${name}`,
    alreadyRunning: name => `${name} is already running`,
    notRunning: name => `${name} isn't running`,
    actionSubtitle: (command, cwd) => `${command} · ${cwd}`,

    // Notifications: the user's name for the service, sanitized, and fixed copy (G4)
    failedTitle: name => `${name} stopped`,
    failedBody: code => `It exited with code ${code}.`,
    gaveUpTitle: name => `${name} keeps stopping`,
    gaveUpBody: restarts => `It stopped again after ${restarts} restarts, so HeadsUp stopped restarting it.`,
    gaveUpAnnouncement: name => `${name} keeps stopping. HeadsUp stopped restarting it.`,

    // The menu
    menuValue: ({running, starting, failed}) => {
        const parts = [];
        if (running)
            parts.push(`${running} running`);
        if (starting)
            parts.push(`${starting} starting`);
        if (failed)
            parts.push(`${failed} failed`);
        return parts.length ? parts.join(' · ') : 'None';
    },
    stopAll: 'Stop All Services',
    /** The note at the top of the editor of a running service (UX flags). */
    runningNote: 'Changes to the command, folder or environment apply the next time it starts.',
};

const KEEP_AWAKE_MINUTES = {'30m': 30, '2h': 120, '5h': 300};

/** Preferences → Services, the editor (the Mac's Strings.ServiceForm, in GNOME's words; Yuki). */
export const ServiceForm = {
    newTitle: 'New Service',
    editTitle: name => name,
    commandHelp: "Runs in your login shell. If your shell isn't bash, zsh, sh, dash or ksh, it runs in bash.",
    environment: 'Environment',
    environmentWarning: "Stored in your settings, readable by your user. Don't put secrets here.",
    environmentHint: 'To use a secret, run the command through a secrets tool, for example “op run -- npm run dev”.',
    envRowTitle: 'KEY=value',
    port: 'Port',
    portHelp: 'Leave empty to detect it after start.',
    autostart: 'Start with HeadsUp',
    autostartHelp: 'Starts this service when HeadsUp starts, at login.',
    keepAwake: 'Keep your computer awake',
    keepAwakeHelp: "Your computer stays awake while this runs and you're using it. After you've been away for this long, it can sleep. Away means no keyboard, mouse or touchpad use. Unlimited keeps it awake even while you're away. The screen can still blank, and closing the lid still suspends. Follows Caffeine's “Only on power adapter”.",
    /** The choices' labels: "Off", "30 min", "2 hours", "5 hours", "Unlimited". */
    keepAwakeChoice: limit => ({'off': 'Off', '30m': '30 min', '2h': '2 hours', '5h': '5 hours', 'unlimited': 'Unlimited'})[limit],
    keepAwakeChoiceSpoken: limit => ({'off': 'Off', '30m': '30 minutes', '2h': '2 hours', '5h': '5 hours', 'unlimited': 'Unlimited'})[limit],
    restartOnExit: 'Restart if it stops',
    restartOnExitHelp: 'If it stops without you stopping it, HeadsUp starts it again. If it keeps stopping, HeadsUp gives up after 5 restarts and tells you.',
    runningNote: Services.runningNote,
    add: 'Add Service',
    intro: 'Long-running commands you start and stop from the HUD.',
    pageDescription: 'Services stop when you log out or turn off HeadsUp. Their output is kept in memory only, never on disk.',
    empty: 'No services yet',
    removeVariable: 'Remove variable',
    addVariable: 'Add Variable',
    // The dialogs (Yuki)
    discardHeading: 'Discard Changes?',
    discardBody: name => `Your changes to ${name} aren't saved.`,
    discardBodyNew: "This new service isn't saved.",
    keepEditing: 'Keep Editing',
    discard: 'Discard',
    removeHeading: name => `Remove ${name}?`,
    removeRunningBody: "It's running. Removing it stops it.",
    cancel: 'Cancel',
    remove: 'Remove',
};
