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
    tabs: [{keys: ['Ctrl', 'PgUp', 'PgDn'], label: 'tabs'}, {keys: ['Esc'], label: 'close'}],
};

/** The first-run welcome (UX §7). */
export const Welcome = {
    title: 'Welcome to HeadsUp',
    /** The first line, by `hud-shortcut-status`; `shortcut` is accelLabel() of the current one. */
    line(status, shortcut) {
        if (status === 'ok')
            return `Press ${shortcut} in any app to open this.`;
        if (status === 'layouts')
            return 'Super+Space switches your keyboard layout. You can let HeadsUp use it in Preferences.';
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
