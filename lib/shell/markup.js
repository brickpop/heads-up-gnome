// The one place that puts text from outside HeadsUp on a label (ADR-002 §5): service output
// now, model and tool text from slice 5. It is set as plain text, never markup, and cut by the
// core's cutTail (64 KB, the end kept, from a line start), so one huge text can't stall the
// shell's layout. Markup built from model text comes here too, in slice 5, escaped run by run.

import {cutTail} from '../core/sanitize.js';

/**
 * Sets `text` on `label` as plain text, cut to its last 64 KB.
 *
 * @param {import('gi://St').default.Label} label
 * @param {string} text
 * @returns {boolean} true when the start was cut: the view then says "Too long to show in full."
 */
export function setPlainText(label, text) {
    const shown = cutTail(text);
    label.text = shown.text;
    return shown.cut;
}
