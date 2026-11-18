// Small St pieces every view shares: buttons, keycaps, footer hints and the hover label.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const HOVER_DELAY_MS = 500;
const HOVER_GAP_PX = 6;

/**
 * A symbolic icon shipped in the extension's `icons/` folder.
 *
 * @param {string} dir the extension's folder
 * @param {string} name the icon's name, without `-symbolic.svg`
 */
export function icon(dir, name) {
    return new Gio.FileIcon({file: Gio.File.new_for_path(`${dir}/icons/${name}-symbolic.svg`)});
}

/**
 * A HUD button. `kind` is primary (accent), secondary or ghost (UX §15). One with an icon and
 * no label is a 28 × 28 square.
 *
 * @param {{label?: string, gicon?: Gio.Icon, kind?: 'primary'|'secondary'|'ghost', accessibleName?: string}} options
 */
export function button({label, gicon, kind = 'secondary', accessibleName}) {
    const widget = new St.Button({
        style_class: `hu-button hu-button-${kind}${label ? '' : ' hu-button-icon'}`,
        can_focus: true,
        label: label ?? null,
        accessible_name: accessibleName ?? label ?? '',
    });
    if (gicon)
        widget.child = new St.Icon({gicon});
    return widget;
}

/**
 * One footer hint: one keycap per key, then what they do (UX §6).
 *
 * @param {{keys: string[], label: string}} hint
 */
export function hint({keys, label}) {
    const box = new St.BoxLayout({style_class: 'hu-hint', y_align: Clutter.ActorAlign.CENTER});
    for (const key of keys)
        box.add_child(new St.Label({text: key, style_class: 'hu-keycap', y_align: Clutter.ActorAlign.CENTER}));
    box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    return box;
}

/**
 * Shows `text` in a label under `widget` after 500 ms of hover, and at once on keyboard
 * focus, in the style of the dash's app labels (UX §6). The shell has no tooltips.
 *
 * @param {import('../../core/scope.js').Scope} scope owns the signals and the timer
 * @param {St.Widget} widget an icon-only control
 * @param {string} text the Mac's tooltip text, e.g. "Focus · Ctrl+2"
 * @param {() => string} scheme the current scheme class, `hu-tooltip-dark` or `hu-tooltip-light`
 */
export function hoverLabel(scope, widget, text, scheme) {
    let label = null;
    let timer = 0;

    const cancelTimer = () => {
        if (timer)
            GLib.source_remove(timer);
        timer = 0;
    };
    const hide = () => {
        cancelTimer();
        label?.destroy();
        label = null;
    };
    const show = () => {
        cancelTimer();
        if (label || !widget.mapped)
            return;
        label = new St.Label({text, style_class: `hu-tooltip ${scheme()}`});
        Main.layoutManager.uiGroup.add_child(label);
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const [x, y] = widget.get_transformed_position();
        const [width, height] = widget.get_transformed_size();
        label.set_position(
            Math.round(x + (width - label.width) / 2),
            Math.round(y + height + HOVER_GAP_PX * scaleFactor));
    };
    const later = () => {
        cancelTimer();
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_DELAY_MS, () => {
            timer = 0;
            show();
            return GLib.SOURCE_REMOVE;
        });
    };

    scope.connect(widget, 'notify::hover', () => (widget.hover ? later() : hide()));
    scope.connect(widget, 'key-focus-in', show);
    scope.connect(widget, 'key-focus-out', hide);
    scope.connect(widget, 'notify::mapped', () => !widget.mapped && hide());
    scope.add({dispose: hide});
}
