// The HUD's own controls, shared by the Focus tab and (from slice 2) Caffeine: selectable cards
// in a group, segment groups, the progress bar, and buttons that show their keycaps.
//
// A group (cards or segments) is one Tab stop, as a radio group is: only its selected item
// takes keyboard focus, and the arrow keys select the previous or next item, stopping at the
// ends, with the focus following (the Mac's cardGroupKeys). Each focusable control carries a
// `focusKey`, so a view rebuilt after a change can give the focus back to the same control.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const BACK_KEYS = new Set([Clutter.KEY_Left, Clutter.KEY_Up, Clutter.KEY_KP_Left, Clutter.KEY_KP_Up]);
/** The gap between cards, as `.hu-card-group`'s spacing. */
const CARD_GAP_PX = 10;
const NEXT_KEYS = new Set([Clutter.KEY_Right, Clutter.KEY_Down, Clutter.KEY_KP_Right, Clutter.KEY_KP_Down]);

/** Marks `widget` as selected, for the style (`:selected`) and for Orca. */
function setSelected(widget, selected) {
    if (selected) {
        widget.add_style_pseudo_class('selected');
        widget.add_accessible_state(Atk.StateType.SELECTED);
    } else {
        widget.remove_style_pseudo_class('selected');
        widget.remove_accessible_state(Atk.StateType.SELECTED);
    }
}

/**
 * Arrow keys on an item of a group: select the neighbour. Returns STOP when handled.
 *
 * @param {Clutter.Event} event
 * @param {number} index the item's index
 * @param {number} count the group's size
 * @param {(index: number) => void} select
 */
function groupArrows(event, index, count, select) {
    if (event.get_state() & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK))
        return Clutter.EVENT_PROPAGATE;
    const key = event.get_key_symbol();
    const step = BACK_KEYS.has(key) ? -1 : NEXT_KEYS.has(key) ? 1 : 0;
    if (!step)
        return Clutter.EVENT_PROPAGATE;
    const next = Math.min(Math.max(index + step, 0), count - 1);
    if (next !== index)
        select(next);
    return Clutter.EVENT_STOP;
}

/**
 * A group of selectable cards: the focus lengths, the break options. `content(item)` builds a
 * card's inside; `select(item)` runs on a click and on the arrow keys.
 *
 * @template T
 * @param {object} options
 * @param {T[]} options.items each with `selected` and `accessibleName`
 * @param {(item: T) => Clutter.Actor} options.content
 * @param {(item: T) => void} options.select the arrow keys' choice
 * @param {(item: T) => void} [options.activate] a click; `select` when left out
 * @param {string} options.focusKey
 * @param {number} [options.columns] a grid of this many columns, wrapping; a single row when left out
 */
export function cardGroup({items, content, select, activate = select, focusKey, columns}) {
    let group;
    let grid = null;
    if (columns) {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        grid = new Clutter.GridLayout({column_homogeneous: true, column_spacing: CARD_GAP_PX * scaleFactor, row_spacing: CARD_GAP_PX * scaleFactor});
        group = new St.Widget({layout_manager: grid, x_expand: true, accessible_role: Atk.Role.PANEL});
    } else {
        group = new St.BoxLayout({style_class: 'hu-card-group', x_expand: true, accessible_role: Atk.Role.PANEL});
    }
    const selectedIndex = Math.max(0, items.findIndex(item => item.selected));
    items.forEach((item, index) => {
        const card = new St.Button({
            style_class: 'hu-card hu-focus-card',
            child: content(item),
            x_expand: true,
            // One Tab stop: the selected card (the first when none is).
            can_focus: index === selectedIndex,
            accessible_name: item.accessibleName,
            accessible_role: Atk.Role.RADIO_BUTTON,
        });
        card.focusKey = focusKey;
        setSelected(card, item.selected);
        card.connect('clicked', () => activate(item));
        card.connect('key-press-event', (_actor, event) =>
            groupArrows(event, index, items.length, next => select(items[next])));
        if (grid)
            grid.attach(card, index % columns, Math.floor(index / columns), 1, 1);
        else
            group.add_child(card);
    });
    return group;
}

/**
 * A labelled row of segments (the snooze group's look): an icon and a label, a hairline, the
 * segments, and optionally a last `action` segment behind another hairline (Stop now), which is
 * never selected and is a Tab stop of its own. The arrow keys select without acting; a click,
 * Space or Enter act.
 *
 * @param {object} options
 * @param {import('gi://Gio').default.Icon} options.gicon
 * @param {string} options.label
 * @param {string} [options.accessibleName] the group's name for Orca, when it differs from `label`
 * @param {{minutes: number, title: string, selected: boolean, accessibleName: string}[]} options.segments
 * @param {(minutes: number) => void} options.select
 * @param {(minutes: number) => void} options.act
 * @param {{title: string, help: string, run: () => void}} [options.action]
 * @param {string} options.focusKey
 * @param {(widget: St.Widget, text: string) => void} options.hoverLabel the shared hover label helper
 */
export function segmentGroup({gicon, label, accessibleName, segments, select, act, action, focusKey, hoverLabel}) {
    const group = new St.BoxLayout({
        style_class: 'hu-segments',
        accessible_role: Atk.Role.PANEL,
        accessible_name: accessibleName ?? label,
    });
    const head = new St.BoxLayout({style_class: 'hu-segments-label hu-ink-2', y_align: Clutter.ActorAlign.CENTER});
    head.add_child(new St.Icon({gicon, y_align: Clutter.ActorAlign.CENTER}));
    head.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    group.add_child(head);
    group.add_child(new St.Widget({style_class: 'hu-segments-line'}));
    const selectedIndex = Math.max(0, segments.findIndex(s => s.selected));
    segments.forEach((segment, index) => {
        const button = new St.Button({
            style_class: 'hu-segment',
            label: segment.title,
            can_focus: index === selectedIndex,
            accessible_name: segment.accessibleName,
            accessible_role: Atk.Role.RADIO_BUTTON,
        });
        button.focusKey = focusKey;
        setSelected(button, segment.selected);
        button.connect('clicked', () => act(segment.minutes));
        button.connect('key-press-event', (_actor, event) =>
            groupArrows(event, index, segments.length, next => select(segments[next].minutes)));
        group.add_child(button);
    });
    if (action) {
        group.add_child(new St.Widget({style_class: 'hu-segments-line'}));
        const button = new St.Button({style_class: 'hu-segment', label: action.title, can_focus: true, accessible_name: action.title});
        button.focusKey = `${focusKey}:action`;
        button.get_accessible()?.set_description(action.help);
        button.connect('clicked', () => action.run());
        hoverLabel(button, action.help);
        group.add_child(button);
    }
    return group;
}

/**
 * A 6 px bar that fills as time passes. Orca reads its label and percentage.
 *
 * @param {string} label
 * @returns {{actor: St.Widget, update: (progress: number) => void}}
 */
export function progressBar(label) {
    const fill = new St.Widget({style_class: 'hu-progress-fill', x_align: Clutter.ActorAlign.START, y_expand: true});
    const track = new St.Widget({
        style_class: 'hu-progress hu-track',
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        accessible_role: Atk.Role.PROGRESS_BAR,
    });
    track.add_child(fill);
    let progress = 0;
    const draw = () => {
        fill.width = Math.round(track.width * Math.min(Math.max(progress, 0), 1));
    };
    track.connect('notify::width', draw);
    return {
        actor: track,
        update(value) {
            progress = value;
            track.accessible_name = `${label}, ${Math.round(progress * 100)}%`;
            draw();
        },
    };
}

/**
 * A HUD button that can show an icon and keycaps after its title: the Focus tab's primary
 * buttons show Ctrl Enter, which runs them from the prompt.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {'primary'|'secondary'|'amber'|'destructive'|'break'} options.kind
 * @param {import('gi://Gio').default.Icon} [options.gicon]
 * @param {string[]} [options.keys] keycaps, e.g. ['Ctrl', 'Enter']
 * @param {string} [options.hint] what Orca says after the title, e.g. "Control-Return"
 * @param {string} options.focusKey
 * @param {() => void} options.run
 */
export function actionButton({title, kind, gicon, keys = [], hint, focusKey, run}) {
    const box = new St.BoxLayout({style_class: 'hu-button-content'});
    if (gicon)
        box.add_child(new St.Icon({gicon, y_align: Clutter.ActorAlign.CENTER}));
    box.add_child(new St.Label({text: title, y_align: Clutter.ActorAlign.CENTER}));
    for (const key of keys)
        box.add_child(new St.Label({text: key, style_class: 'hu-keycap', y_align: Clutter.ActorAlign.CENTER}));
    const button = new St.Button({
        style_class: `hu-button hu-button-${kind}`,
        child: box,
        can_focus: true,
        accessible_name: title,
    });
    if (hint)
        button.get_accessible()?.set_description(hint);
    button.focusKey = focusKey;
    button.connect('clicked', () => run());
    return button;
}

/**
 * A switch: GNOME's own toggle switch, in a button that takes keyboard focus and that Orca
 * reads as a toggle. Space, Enter or a click toggle it. A disabled one still takes hover and
 * focus, so its `disabledHelp` can say why (the Mac's tooltip), but doesn't toggle.
 *
 * @param {object} options
 * @param {string} options.label what Orca says
 * @param {boolean} options.on
 * @param {boolean} [options.enabled]
 * @param {string} [options.disabledHelp] why it is off, shown on hover and read by Orca
 * @param {(widget: St.Widget, text: string) => void} [options.hoverLabel] the shared hover label helper
 * @param {string} options.focusKey
 * @param {() => void} options.toggle
 */
export function toggleSwitch({label, on, enabled = true, disabledHelp, hoverLabel, focusKey, toggle}) {
    const button = new St.Button({
        style_class: 'hu-switch',
        child: new PopupMenu.Switch(on),
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
        accessible_role: Atk.Role.TOGGLE_BUTTON,
        accessible_name: label,
    });
    if (on)
        button.add_accessible_state(Atk.StateType.CHECKED);
    if (!enabled) {
        // St has no opacity in CSS: a disabled control is drawn at half (UX §15).
        button.opacity = 128;
        button.add_accessible_state(Atk.StateType.INSENSITIVE);
        if (disabledHelp) {
            button.get_accessible()?.set_description(disabledHelp);
            hoverLabel?.(button, disabledHelp);
        }
    }
    button.focusKey = focusKey;
    button.connect('clicked', () => enabled && toggle());
    return button;
}
